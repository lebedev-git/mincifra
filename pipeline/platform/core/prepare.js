"use strict";
// Автоматическая подготовка артефактов реестра ПРЯМО НА ЭТОМ ПК (без скачивания
// скрипта). Локальный сервер платформы сам выполняет шаги, которые раньше делал
// prepare.ps1/.sh, и складывает результат в артефакты продукта:
//   1) git clone --depth 1 <repo>      — свежая копия кода во временную папку
//   2) git archive --format=zip HEAD   — чистый снимок версии (без .git/node_modules)
//   3) SHA-256 архива                  — нативно через crypto (внешних утилит не нужно)
//   4) cdxgen                          — SBOM (CycloneDX). Требует сеть при первом npx.
//
// Итог: dep_snapshot_snapshot.zip (закрывает пункт «Снимок кода» и даёт SHA-256 для
// «Акта фиксации») и sbom.json (участвует в технических проверках лицензий).
//
// Безопасность: репозиторий передаётся git как отдельный аргумент (без shell),
// URL проверяется по белому списку схем; всё выполняется во временном каталоге,
// который удаляется по завершении.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const store = require("./store");

const STEP_TIMEOUT_MS = 5 * 60 * 1000;   // на git-шаги
const SBOM_TIMEOUT_MS = 10 * 60 * 1000;  // cdxgen через npx может тянуть пакет из сети

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

// Допускаем только явно безопасные формы ссылки на репозиторий: http(s), ssh (git@host:path),
// git://, а также локальный путь. Отсекаем опции/флаги (начинается с «-») и переносы строк.
function validateRepo(repoRaw) {
  const repo = String(repoRaw || "").trim();
  if (!repo) throw httpError(400, "Укажите ссылку на репозиторий.");
  if (/[\r\n\0]/.test(repo)) throw httpError(400, "Недопустимые символы в ссылке.");
  if (repo.startsWith("-")) throw httpError(400, "Недопустимая ссылка на репозиторий.");
  const ok =
    /^https?:\/\/[^\s]+$/i.test(repo) ||
    /^git:\/\/[^\s]+$/i.test(repo) ||
    /^[A-Za-z0-9._-]+@[^\s:]+:[^\s]+$/.test(repo) ||   // scp-подобный ssh: git@github.com:org/repo.git
    /^ssh:\/\/[^\s]+$/i.test(repo);
  if (!ok) throw httpError(400, "Поддерживаются ссылки https://, ssh:// или git@host:path.");
  return repo;
}

// Запуск внешней команды без shell. Возвращает { code, stdout, stderr } либо reject с ошибкой.
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, shell: false });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(httpError(504, `Команда «${cmd}» превысила лимит времени.`)); },
      opts.timeout || STEP_TIMEOUT_MS);
    if (child.stdout) child.stdout.on("data", (d) => { stdout += d; });
    if (child.stderr) child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// Есть ли исполняемый файл в PATH (git / npx). Проверяем через «--version».
function hasTool(cmd) {
  return new Promise((resolve) => {
    execFile(cmd, ["--version"], { shell: false, timeout: 15000 }, (err) => resolve(!err));
  });
}

// Статус инструментов для UI: можно ли делать снимок (git) и SBOM (npx/cdxgen).
async function status() {
  const [git, npx] = await Promise.all([hasTool("git"), hasTool("npx")]);
  return { git, npx, canSnapshot: git, canSbom: npx };
}

// Основной сценарий. onStep(msg) — колбэк прогресса (пишется в лог/стрим при желании).
// Возвращает сводку: { archive, sha256, sizeBytes, sbom|null, warnings[] }.
async function prepare(id, repoRaw, onStep = () => {}) {
  store.getProduct(id); // 404, если продукта нет
  const repo = validateRepo(repoRaw);

  if (!(await hasTool("git")))
    throw httpError(422, "Не найден git. Установите его (git-scm.com) или воспользуйтесь ручными командами.");

  const warnings = [];
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "reestr-prep-"));
  const srcDir = path.join(work, "src");
  const zipPath = path.join(work, "snapshot.zip");
  try {
    onStep("1/4 Клонирую репозиторий…");
    const clone = await run("git", ["clone", "--depth", "1", repo, srcDir]);
    if (clone.code !== 0)
      throw httpError(422, `git clone завершился с ошибкой: ${firstLine(clone.stderr) || "проверьте ссылку и доступ."}`);

    onStep("2/4 Делаю чистый снимок версии (ZIP)…");
    const archive = await run("git", ["-C", srcDir, "archive", "--format=zip", "-o", zipPath, "HEAD"]);
    if (archive.code !== 0 || !fs.existsSync(zipPath))
      throw httpError(422, `git archive завершился с ошибкой: ${firstLine(archive.stderr) || "неизвестная причина."}`);

    onStep("3/4 Считаю контрольную сумму SHA-256…");
    const zipBuf = fs.readFileSync(zipPath);
    const sha256 = crypto.createHash("sha256").update(zipBuf).digest("hex");
    // Снимок кода → артефакт dep_snapshot_snapshot.zip (закрывает пункт трекера и даёт
    // хеш для «Акта фиксации версии», который считается адаптером депонирования).
    store.saveArtifact(id, "dep_snapshot_snapshot.zip", zipBuf);

    // Пока исходники распакованы — собираем текстовый листинг как сырьё для документа
    // «Фрагмент исходного кода» (генерация .docx с правилом 70 страниц — по кнопке позже).
    let listing = null;
    try {
      const text = collectListing(srcDir);
      if (text) { store.saveArtifact(id, LISTING_ARTIFACT, Buffer.from(text, "utf8")); listing = LISTING_ARTIFACT; }
    } catch (e) { warnings.push("Не удалось собрать листинг кода для фрагмента: " + (e.message || e)); }

    onStep("4/4 Генерирую SBOM (список библиотек и лицензий)…");
    let sbom = null;
    if (await hasTool("npx")) {
      const sbomPath = path.join(work, "sbom.json");
      const gen = await run("npx", ["--yes", "@cyclonedx/cdxgen@latest", "-o", sbomPath, srcDir],
        { timeout: SBOM_TIMEOUT_MS });
      if (gen.code === 0 && fs.existsSync(sbomPath)) {
        store.saveArtifact(id, "sbom.json", fs.readFileSync(sbomPath));
        sbom = "sbom.json";
      } else {
        warnings.push("SBOM не сгенерирован (cdxgen недоступен или нет сети). Снимок и SHA-256 готовы; SBOM можно загрузить вручную.");
      }
    } else {
      warnings.push("Не найден npx (Node.js) — SBOM пропущен. Снимок и SHA-256 готовы.");
    }

    return { archive: "dep_snapshot_snapshot.zip", sha256, sizeBytes: zipBuf.length, sbom, listing, warnings };
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* временная папка */ }
  }
}

function firstLine(s) { return String(s || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || ""; }

// Имя артефакта-сырья с исходным листингом (используется генератором фрагмента кода).
const LISTING_ARTIFACT = "dep_codefrag_listing.txt";
// Исходники, которые включаем в листинг (значимые модули). Двоичное и зависимости — мимо.
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".java",
  ".cs", ".php", ".rb", ".rs", ".c", ".h", ".cpp", ".hpp", ".kt", ".swift", ".sql", ".sh"]);
const SKIP_DIR = new Set(["node_modules", ".git", "dist", "build", "vendor", "__pycache__",
  ".venv", "venv", ".idea", ".vscode", "coverage"]);
const MAX_LISTING_BYTES = 8 * 1024 * 1024; // предел на собранный листинг (защита от гигантских репо)

// Обходит дерево исходников и собирает единый текст с заголовками-разделителями по файлам.
// Порядок — детерминированный (сортировка), чтобы «первые/последние страницы» были стабильны.
function collectListing(root) {
  const files = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(path.join(dir, e.name)); }
      else if (CODE_EXT.has(path.extname(e.name).toLowerCase())) files.push(path.join(dir, e.name));
    }
  })(root);

  const parts = [];
  let total = 0;
  for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, "/");
    let body;
    try { body = fs.readFileSync(f, "utf8"); } catch (_) { continue; }
    const block = `\n${"=".repeat(78)}\n// Файл: ${rel}\n${"=".repeat(78)}\n${body}\n`;
    total += Buffer.byteLength(block, "utf8");
    if (total > MAX_LISTING_BYTES) { parts.push("\n[…листинг усечён по размеру…]\n"); break; }
    parts.push(block);
  }
  return parts.join("");
}

module.exports = {
  prepare, status, validateRepo, LISTING_ARTIFACT,
  // Переиспользуется локальным источником (core/localsource.js), чтобы не дублировать логику.
  hasTool, run, collectListing, firstLine, CODE_EXT, SKIP_DIR, MAX_LISTING_BYTES,
  SBOM_TIMEOUT_MS, httpError,
};
