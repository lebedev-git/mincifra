"use strict";
// MCP-сервер платформы реестра ПО. Тонкая обёртка над HTTP-API (server.js):
// даёт агенту чистые инструменты вместо парсинга HTML/сырого REST.
//
// Транспорт — stdio, протокол — JSON-RPC 2.0 построчно (по одному объекту на
// строку), как в MCP stdio. Зависимостей нет: только node:readline / node:http.
//
// Запуск (обычно поднимает MCP-клиент, напр. Claude):
//   PLATFORM_URL=http://127.0.0.1:3000 node mcp/server.js
// По умолчанию бьёт в http://127.0.0.1:3000 (порт платформы, см. server.js).
//
// ВАЖНО: stdout занят протоколом — любые логи только в stderr (console.error),
// иначе клиент получит битый JSON-RPC.

const http = require("http");
const https = require("https");
const readline = require("readline");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { URL } = require("url");

// PLATFORM_URL поддерживает http и https, а также basic-auth в самом URL:
//   https://логин:пароль@mincifra.example.ru  →  заголовок Authorization: Basic …
const BASE = (process.env.PLATFORM_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
// Адрес без логина/пароля — для логов и сообщений об ошибках.
const BASE_SAFE = (() => {
  try { const u = new URL(BASE); u.username = ""; u.password = ""; return u.toString().replace(/\/+$/, ""); }
  catch (_) { return BASE; }
})();
const SERVER_INFO = { name: "reestr-platform", version: "1.1.0" };
const PROTOCOL_VERSION = "2024-11-05";
// Имя клиента — показывается на дашборде платформы («кто подключён», лента действий).
const CLIENT_NAME = (process.env.REESTR_CLIENT_NAME || "").trim().slice(0, 64) ||
  (process.env.USERNAME || process.env.USER || "агент");

// --- HTTP-клиент к платформе (JSON in/out) ---
// body: объект → JSON; Buffer → сырое тело (загрузка ZIP/файлов), тип из opts.contentType.
function httpJson(method, apiPath, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + apiPath);
    const secure = u.protocol === "https:";
    const lib = secure ? https : http;
    const raw = Buffer.isBuffer(body);
    const payload = body === undefined ? null : (raw ? body : Buffer.from(JSON.stringify(body), "utf8"));
    const headers = {
      "Accept": "application/json",
      "X-Reestr-Client": encodeURIComponent(CLIENT_NAME),
      ...(payload ? {
        "Content-Type": raw ? (opts.contentType || "application/octet-stream") : "application/json",
        "Content-Length": payload.length,
      } : {}),
    };
    // Basic-auth из URL (https://user:pass@host) — стандартный способ защиты за nginx.
    if (u.username) {
      const cred = decodeURIComponent(u.username) + ":" + decodeURIComponent(u.password || "");
      headers["Authorization"] = "Basic " + Buffer.from(cred, "utf8").toString("base64");
    }
    const req = lib.request({
      hostname: u.hostname, port: u.port || (secure ? 443 : 80), path: u.pathname + u.search,
      method, headers,
      // agent:false — своё соединение на запрос. С keep-alive (в Node ≥19 он по умолчанию)
      // сокет простаивает, пока мы пакуем папку, сервер рвёт его по таймауту, и следующий
      // запрос уходит в мёртвое соединение → ECONNRESET. Запросов мало, экономия не нужна.
      agent: false,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(`HTTP ${res.statusCode} ${method} ${apiPath}: ${(data && data.error) || text || ""}`));
      });
    });
    req.on("error", (e) => reject(new Error(
      `Платформа недоступна по ${BASE_SAFE} — ${method} ${apiPath} (${e.message}). Запущен ли server.js?`)));
    if (payload) req.write(payload);
    req.end();
  });
}

// Глубокое слияние патча в объект: объекты сливаются рекурсивно, скаляры и
// МАССИВЫ заменяются целиком (массив class/os/subd задаётся агентом полностью).
function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      target[k] = (target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) ? target[k] : {};
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

// Короткая сводка чек-листа (для ответа patch/run_checks — агенту сразу видно
// прогресс и следующую стадию, без второго запроса).
function checklistDigest(t) {
  if (!t) return null;
  return {
    percent: t.percent,
    nextStageId: t.nextStageId,
    checksOverall: t.checksOverall,
    stages: (t.stages || []).map((s) => ({
      id: s.id, title: s.title, done: s.done, total: s.total, complete: s.complete,
      open: (s.items || []).filter((i) => !i.done).map((i) => i.text),
    })),
  };
}

// Источник проекта: git-URL vs локальный путь (критерий как в fstek scan_project).
function isRepoUrl(s) {
  const t = String(s || "").trim();
  return /^https?:\/\//i.test(t) || /^git@/i.test(t);
}

// --- Локальный источник → ZIP -------------------------------------------
// Обёртка работает НА МАШИНЕ ПОЛЬЗОВАТЕЛЯ, а платформа может стоять на сервере,
// поэтому путь вида C:\... ей передавать бессмысленно (её ФС — другая). Папку
// упаковываем здесь и отдаём архивом: /autofill принимает ZIP сырым телом.
// Набор архиваторов тот же, что в core/localsource.js (git-репо → снимок без .git).
const MAX_ZIP_BYTES = 300 * 1024 * 1024; // предел платформы на загружаемый ZIP

function psQuote(s) { return String(s).replace(/'/g, "''"); }

// Пакует каталог в ZIP. Возвращает { buffer, cleanup } — cleanup удаляет temp.
function zipLocalDir(dir) {
  const abs = path.resolve(String(dir || "").trim());
  let st;
  try { st = fs.statSync(abs); } catch (_) { throw new Error(`Папка не найдена: ${abs}`); }
  if (!st.isDirectory()) throw new Error(`Это не папка: ${abs}`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "reestr-mcp-"));
  const zip = path.join(work, "source.zip");
  const cleanup = () => { try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {} };

  // Порядок: git archive (чистый снимок трекнутых файлов) → Compress-Archive → zip → bsdtar.
  const tries = [];
  if (fs.existsSync(path.join(abs, ".git")))
    tries.push(["git", ["-C", abs, "archive", "--format=zip", "-o", zip, "HEAD"], {}]);
  if (process.platform === "win32")
    tries.push(["powershell", ["-NoProfile", "-NonInteractive", "-Command",
      `Compress-Archive -Path '${psQuote(abs)}\\*' -DestinationPath '${psQuote(zip)}' -Force`], {}]);
  tries.push(["zip", ["-r", "-q", zip, "."], { cwd: abs }]);
  tries.push(["tar", ["-a", "-c", "-f", zip, "-C", abs, "."], {}]);

  for (const [cmd, args, opts] of tries) {
    let r;
    try { r = spawnSync(cmd, args, { ...opts, stdio: "ignore", windowsHide: true }); }
    catch (_) { r = { status: 1 }; }
    // Успех определяем по файлу, а не по коду возврата: PowerShell/git ведут себя по-разному.
    if (r.status === 0 && fs.existsSync(zip) && fs.statSync(zip).size > 0) {
      const buffer = fs.readFileSync(zip);
      if (buffer.length > MAX_ZIP_BYTES) {
        cleanup();
        throw new Error(
          `Снимок ${(buffer.length / 1048576).toFixed(0)} МБ превышает лимит платформы ` +
          `${MAX_ZIP_BYTES / 1048576} МБ. В подачу идут ИСХОДНИКИ — вынесите крупные бинарники/медиа ` +
          `из папки (или добавьте в .gitignore, если это git-репозиторий).`);
      }
      return { buffer, cleanup };
    }
    try { fs.rmSync(zip, { force: true }); } catch (_) {}
  }
  cleanup();
  throw new Error("Не удалось собрать ZIP из папки: не найден ни git, ни PowerShell, ни zip, ни tar.");
}

// Читает локальный файл для выгрузки на платформу.
function readLocalFile(p) {
  const abs = path.resolve(String(p || "").trim());
  let st;
  try { st = fs.statSync(abs); } catch (_) { throw new Error(`Файл не найден: ${abs}`); }
  if (!st.isFile()) throw new Error(`Это не файл: ${abs}`);
  if (!st.size) throw new Error(`Файл пуст: ${abs}`);
  if (st.size > MAX_ZIP_BYTES) throw new Error(`Файл больше ${MAX_ZIP_BYTES / 1048576} МБ — платформа не примет.`);
  return { buffer: fs.readFileSync(abs), name: path.basename(abs) };
}

// --- Инструменты MCP ---
const TOOLS = [
  {
    name: "list_products",
    description: "Список продуктов с готовностью (percent) и статусом проверок. Начни отсюда, чтобы найти id.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => (await httpJson("GET", "/api/products")).products,
  },
  {
    name: "create_product",
    description: "Создать продукт из шаблона (реквизиты подтянутся из профиля). Возвращает id.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Название продукта" } },
      required: ["name"], additionalProperties: false,
    },
    run: async (a) => await httpJson("POST", "/api/products", { name: a.name }),
  },
  {
    name: "get_product",
    description: "Полная карточка продукта (объект product со всеми полями). Пути полей — см. AGENTS.md.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"], additionalProperties: false,
    },
    run: async (a) => (await httpJson("GET", `/api/products/${encodeURIComponent(a.id)}`)).product,
  },
  {
    name: "get_checklist",
    description: "Чек-лист-проекция: 5 стадий, какие пункты закрыты/открыты, nextStageId. Пункты закрываются САМИ из данных.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"], additionalProperties: false,
    },
    run: async (a) => checklistDigest((await httpJson("GET", `/api/products/${encodeURIComponent(a.id)}/tracker`)).tracker),
  },
  {
    name: "patch_product",
    description: "Заполнить/обновить поля карточки. changes — частичный объект по структуре product (напр. {\"rightholder\":{\"inn\":\"7701...\"},\"finance\":{\"annualRevenueProduct\":5000000}}). Сливается с текущей карточкой (не затирает остальное); массивы заменяются целиком. Возвращает обновлённый чек-лист.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        changes: { type: "object", description: "Частичный product: только меняемые поля" },
      },
      required: ["id", "changes"], additionalProperties: false,
    },
    run: async (a) => {
      const cur = (await httpJson("GET", `/api/products/${encodeURIComponent(a.id)}`)).product || {};
      deepMerge(cur, a.changes);
      await httpJson("PUT", `/api/products/${encodeURIComponent(a.id)}`, { product: cur });
      // После сохранения проверки пересчитываются самой платформой при заходе; дёрнем
      // тихо, чтобы чек-лист отражал свежие данные так же, как в UI.
      await httpJson("POST", `/api/products/${encodeURIComponent(a.id)}/checks`).catch(() => {});
      return checklistDigest((await httpJson("GET", `/api/products/${encodeURIComponent(a.id)}/tracker`)).tracker);
    },
  },
  {
    name: "run_checks",
    description: "Прогнать технические проверки (правило 30%, лицензии OSS, сетевой аудит, страница). Возвращает итог и чек-лист.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"], additionalProperties: false,
    },
    run: async (a) => {
      const r = await httpJson("POST", `/api/products/${encodeURIComponent(a.id)}/checks`);
      const t = checklistDigest((await httpJson("GET", `/api/products/${encodeURIComponent(a.id)}/tracker`)).tracker);
      return { overall: r.report && r.report.overall, totals: r.report && r.report.totals, checklist: t };
    },
  },
  {
    name: "get_profile",
    description: "Единый профиль установки: реквизиты ООО (rightholder), автор-физлицо для Роспатента (author: fullName, birthDate, citizenship, snils, address), контакты техподдержки (support).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => (await httpJson("GET", "/api/profile")).profile,
  },
  {
    name: "set_profile",
    description:
      "Заполнить/обновить профиль. profile — частичный объект; сервер принимает ТОЛЬКО поля белого списка " +
      "(author.fullName/birthDate/citizenship/snils/address, rightholder.orgName/inn/ogrn/address/ruControlSharePercent/signatory.name/signatory.position, " +
      "support.contactFio/contactEmail/contactPhone) — всё прочее отбрасывается. Незатронутые поля сохраняются.",
    inputSchema: {
      type: "object",
      properties: { profile: { type: "object", description: "Частичный профиль: только меняемые поля" } },
      required: ["profile"], additionalProperties: false,
    },
    run: async (a) => {
      const cur = (await httpJson("GET", "/api/profile")).profile || {};
      deepMerge(cur, a.profile || {});
      return await httpJson("PUT", "/api/profile", { profile: cur });
    },
  },
  {
    name: "prepare_rospatent",
    description:
      "ОДИН вызов: загрузить проект → получить всё для подачи программы для ЭВМ в Роспатент через Госуслуги/ФИПС (на физлицо). " +
      "source = путь к папке проекта на этом ПК ИЛИ git-URL (как scan_project). " +
      "productId (необязательно) = подготовить СУЩЕСТВУЮЩИЙ продукт из list_products; без него создаётся новый. " +
      "Делает снимок версии кода, фрагмент кода (50 стр.), генерит два PDF (Реферат + Фрагмент кода, Times New Roman) " +
      "и возвращает готовый лист полей формы «Сведения о программе» + реферат ≤900 симв. " +
      "Свидетельство и цепочку прав НЕ трогает — это чистый роспатентный трек для физлица.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Путь к папке проекта на ЭТОМ устройстве (упакуется и загрузится на платформу) или git-URL" },
        name: { type: "string", description: "Название программы (по умолчанию — из package.json/имени папки)" },
        productId: { type: "string", description: "id СУЩЕСТВУЮЩЕГО продукта (из list_products) — подготовить его, а не создавать новый" },
      },
      required: ["source"], additionalProperties: false,
    },
    run: async (a) => {
      const source = String(a.source || "").trim();
      if (!source) throw new Error("Укажи source — путь к папке проекта или git-URL.");

      // 1) Продукт: существующий (productId) или новый (реквизиты подтянутся из профиля).
      let id;
      if (a.productId) {
        id = String(a.productId).trim();
        await httpJson("GET", `/api/products/${encodeURIComponent(id)}`); // валидация: продукт существует
      } else {
        const productName = a.name || "Программа для ЭВМ (черновик)";
        const created = await httpJson("POST", "/api/products", { name: productName });
        id = created.id;
        if (!id) throw new Error("Не удалось создать продукт: " + JSON.stringify(created));
      }

      // 2) Снимок кода + SHA-256 + фрагмент + черновик карточки.
      //    git-URL → prepare (клон по ссылке); локальный путь → autofill.
      let sha256 = null, sizeBytes = null;
      if (isRepoUrl(source)) {
        const pr = await httpJson("POST", `/api/products/${encodeURIComponent(id)}/prepare`, { repo: source });
        sha256 = (pr.result && pr.result.sha256) || null;
        sizeBytes = (pr.result && pr.result.sizeBytes) || null;
      } else {
        // Папка с ЭТОГО устройства: пакуем локально и грузим архивом — платформа
        // может стоять на другой машине, её ФС нашего пути не видит.
        const packed = zipLocalDir(source);
        let af;
        try {
          af = await httpJson("POST", `/api/products/${encodeURIComponent(id)}/autofill`,
            packed.buffer, { contentType: "application/zip" });
        } finally { packed.cleanup(); }
        sha256 = (af.result && af.result.sha256) || null;
        sizeBytes = (af.result && af.result.sizeBytes) || null;
        // Применить черновик полей карточки (autofill только предлагает patch, не сохраняет).
        const patch = af.draft && af.draft.patch;
        if (patch && Object.keys(patch).length) {
          const cur = (await httpJson("GET", `/api/products/${encodeURIComponent(id)}`)).product || {};
          deepMerge(cur, patch);
          await httpJson("PUT", `/api/products/${encodeURIComponent(id)}`, { product: cur });
        }
      }

      // 3) Идентифицирующие материалы (ст. 1262 ГК): Реферат + Фрагмент кода — два PDF
      //    (Times New Roman), только они грузятся в заявку. Строятся из свежего листинга
      //    (он ещё существует после шага 2); эндпоинт сам фиксирует язык и удаляет сырьё.
      const documents = [];
      try {
        const pdf = await httpJson("POST", `/api/products/${encodeURIComponent(id)}/rospatent/pdf`);
        for (const d of (pdf.documents || [])) {
          documents.push({
            kind: d.kind, title: d.title, file: d.name, bytes: d.bytes,
            // Для графы 9 заявления: «на ___ л. в ___ экз.».
            pages: d.pages, copies: d.copies,
            downloadUrl: `/api/products/${encodeURIComponent(id)}/artifacts/file/${encodeURIComponent(d.name)}`,
          });
        }
      } catch (e) {
        documents.push({ error: e.message });
      }

      // 4) Лист полей формы Госуслуг / ФИПС + реферат. Сначала автозаполнение
      //    выводимых полей (язык из листинга, тип ЭВМ, год, объём из снимка).
      const ros = (await httpJson("POST", `/api/products/${encodeURIComponent(id)}/rospatent/autofill`)
        .catch(async () => await httpJson("GET", `/api/products/${encodeURIComponent(id)}/rospatent`))).rospatent || {};

      // 5) Мягкая диагностика: чего не хватает для чистовой подачи.
      const missing = [];
      if (!sha256) missing.push("Снимок версии кода не создан — проверь путь/доступность источника.");
      if (!ros.authorFilled) missing.push("Профиль автора-физлица пуст (ФИО, СНИЛС, адрес) — заполни в «Профиль», иначе заявление ДоЭВМ с прочерками.");
      documents.filter((d) => d.error).forEach((d) => missing.push(`PDF не собран: ${d.error}`));

      return {
        productId: id,
        sha256,
        sizeBytes,
        gosuslugi: {
          fields: ros.fields || [],
          applicant: ros.applicant || [],
          referat: ros.referat || "",
          referatLen: ros.referatLen,
          referatLimit: ros.referatLimit,
        },
        documents,
        missing,
        hint: "Скопируй gosuslugi.fields в форму «Сведения о программе» на Госуслугах/ФИПС; приложи два PDF из documents (Реферат + Фрагмент кода). Свидетельство придёт из Роспатента отдельно.",
      };
    },
  },
  {
    name: "upload_material",
    description:
      "Приложить к продукту файл с ЭТОГО устройства (свидетельство Роспатента, доп. материалы, SBOM, HAR). " +
      "kind: rights — правовые документы и свидетельство; dep_<что-то> (напр. dep_extra) — материалы подачи; " +
      "sbom / har — для технических проверок. Возвращает список артефактов продукта.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id продукта (из list_products)" },
        path: { type: "string", description: "Путь к файлу на этом устройстве" },
        kind: { type: "string", description: "rights | dep_<категория> | sbom | har (по умолчанию rights)" },
        name: { type: "string", description: "Имя файла на платформе (по умолчанию — исходное)" },
      },
      required: ["id", "path"], additionalProperties: false,
    },
    run: async (a) => {
      const kind = String(a.kind || "rights").trim();
      const file = readLocalFile(a.path);
      const name = String(a.name || file.name).trim();
      return await httpJson(
        "PUT",
        `/api/products/${encodeURIComponent(a.id)}/artifacts/${encodeURIComponent(kind)}?name=${encodeURIComponent(name)}`,
        file.buffer, { contentType: "application/octet-stream" });
    },
  },
];
const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

// --- JSON-RPC поверх stdio ---
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function replyError(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg;
  // Уведомления (без id) — только реагируем, не отвечаем.
  if (id === undefined || id === null) return;

  try {
    if (method === "initialize") {
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    } else if (method === "ping") {
      reply(id, {});
    } else if (method === "tools/list") {
      reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    } else if (method === "tools/call") {
      const tool = TOOL_BY_NAME[(params && params.name) || ""];
      if (!tool) { replyError(id, -32602, `Неизвестный инструмент: ${params && params.name}`); return; }
      try {
        const out = await tool.run((params && params.arguments) || {});
        reply(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        // Ошибку инструмента возвращаем как isError-результат (модель это увидит и поправит запрос).
        reply(id, { content: [{ type: "text", text: "Ошибка: " + (e.message || String(e)) }], isError: true });
      }
    } else {
      replyError(id, -32601, `Метод не поддерживается: ${method}`);
    }
  } catch (e) {
    replyError(id, -32603, e.message || String(e));
  }
}

// Запуск только как самостоятельный процесс — при require (selftest) stdio не трогаем.
if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const s = line.trim();
    if (!s) return;
    let msg;
    try { msg = JSON.parse(s); } catch (_) { return; } // мусор игнорируем
    handle(msg);
  });
  // Сигнал платформе «клиент подключился» — дашборд показывает имя и время.
  // Ошибку глотаем: платформа может быть ещё не поднята, это не повод падать.
  httpJson("POST", "/api/hello", { name: CLIENT_NAME, client: "mcp" }).catch(() => {});
  process.stderr.write(`[reestr-mcp] запущен (${CLIENT_NAME}), платформа: ${BASE_SAFE}\n`);
}

module.exports = { zipLocalDir, readLocalFile, TOOLS };
