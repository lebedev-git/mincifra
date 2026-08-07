"use strict";
// Выдача MCP-клиента одним архивом: GET /api/client.zip
//
// Внутри: mcp/server.js (копия с этого же сервера), .mcp.json с уже вписанным
// адресом платформы и README. Адрес берётся из env REESTR_PUBLIC_URL
// (например https://логин:пароль@mincifra.example.ru); без него — из Host.
//
// ZIP собирается без зависимостей: метод store (без сжатия) + CRC-32.
// Файлы мелкие, сжатие не нужно — зато README и конфиг всегда свежие.

const fs = require("fs");
const path = require("path");
const { sendJson } = require("../core/http-util");

const MCP_SERVER_FILE = path.join(__dirname, "..", "mcp", "server.js");
// Самопроверка окружения на устройстве пользователя: есть ли архиватор для
// упаковки папки проекта. Кладём в архив — это первый шаг диагностики «не работает».
const MCP_SELFTEST_FILE = path.join(__dirname, "..", "mcp", "selftest.js");

// --- CRC-32 (таблица считается один раз) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ZIP из списка { name, data:Buffer } методом store. Имена — UTF-8 (флаг 0x0800).
function buildZip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);     local.writeUInt16LE(0, 8); // store
    local.writeUInt32LE(0, 10); // время/дата не пишем (детерминированный архив)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);   local.writeUInt16LE(0, 28);
    parts.push(local, name, f.data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);     cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(0, 12);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(f.data.length, 20); cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, name]));
    offset += 30 + name.length + f.data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

// Публичный адрес платформы для конфига клиента.
function publicUrl(req) {
  if (process.env.REESTR_PUBLIC_URL) return process.env.REESTR_PUBLIC_URL.replace(/\/+$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "127.0.0.1:3000";
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}`;
}

function mcpJson(url) {
  return JSON.stringify({
    mcpServers: {
      "reestr-platform": {
        command: "node",
        args: ["./mcp/server.js"],
        env: { PLATFORM_URL: url, REESTR_CLIENT_NAME: "" },
      },
    },
  }, null, 2) + "\n";
}

function readme(url) {
  const safe = url.replace(/\/\/[^@/]+@/, "//");
  return `# Подключение Claude к платформе подготовки заявок в Роспатент

Сервер: ${safe}. Всё делает Claude — от вас 3 шага.

1. Распакуйте архив, например в C:\\reestr-mcp (Windows) или ~/reestr-mcp.
   Нужен Node.js 18+ (проверка в терминале: node -v; если нет — https://nodejs.org, LTS).
2. Запустите Claude Code ИЗ ЭТОЙ ПАПКИ — подключение подхватится само,
   адрес платформы уже вписан в .mcp.json. Там же можно указать своё имя
   в REESTR_CLIENT_NAME — оно видно на дашборде платформы.
3. Скажите Claude: «старт».

Дальше Claude сам покажет продукты, спросит путь к папке с исходным кодом,
соберёт снимок кода, реферат и два PDF и выдаст готовый лист полей для формы
на Госуслугах. Всё сохраняется на платформе — с любого устройства картина одна.

## Что нужно на устройстве

- Node.js 18 и новее.
- Архиватор для упаковки папки проекта. Windows — есть из коробки (PowerShell).
  macOS — есть (zip). Linux — если папка не git-репозиторий, поставьте zip:
  apt install zip (иначе используйте git-репозиторий или git-URL).
- Проверка окружения: node mcp/selftest.js — скажет, всё ли на месте.

## Важно

- Файл .mcp.json содержит доступ к вашей платформе — не выкладывайте его
  в открытый доступ и не кладите в публичный репозиторий.
- Персональные данные (ИНН, паспорт, СНИЛС) вводите сами, когда Claude спросит.
`;
}

// Инструкция для самого Claude: лежит в корне распакованной папки, Claude Code
// читает её автоматически. Это ЕДИНСТВЕННЫЙ источник процесса на чистом
// устройстве (истории чата там нет) — держать в актуальном состоянии вместе
// с инструментами mcp/server.js.
function claudeMd(url) {
  const safe = url.replace(/\/\/[^@/]+@/, "//");
  return `# Подача программы для ЭВМ в Роспатент

Ты — агент подготовки заявки на государственную регистрацию программы для ЭВМ
(Роспатент, через Госуслуги/ФИПС; заявитель — физическое лицо). Подключён к
платформе ${safe} через MCP-сервер reestr-platform. Отвечай по-русски, коротко,
человекочитаемыми блоками — не вываливай JSON.

Данные хранятся на платформе, а не на этом устройстве: с любого компьютера
видна одна и та же картина.

## Старт («старт», «поехали», приветствие)

1. list_products — покажи нумерованный список продуктов (номер, название,
   готовность) + пункт «0 — создать новый». Пользователь выбирает цифрой.
2. get_profile — проверь profile.authors. Если пусто или у автора не хватает
   полей, СПРОСИ и сохрани через set_profile (см. «Авторы» ниже).
3. Спроси **путь к папке проекта на этом устройстве** (можно и git-URL).
   Локальный путь работает: обёртка сама упакует папку и загрузит на платформу.
4. Спроси, чем занимается программа: назначение и функциональные возможности —
   и сохрани через patch_product (product.purpose, product.description).
   Без этого реферат получится пустым. Также уточни:
   - обрабатывает ли программа персональные данные (графа 3; если да — нужен
     регистрационный номер в реестре операторов Роскомнадзора);
   - выпущена ли уже в свет (графа 5: страна и год обнародования).
5. prepare_rospatent {source, productId} — снимок кода, реферат, два PDF,
   лист полей по графам заявления.
6. Выдай пользователю РОВНО два блока (см. ниже). Если massive missing не пуст —
   отдельным блоком «Чего не хватает» и помоги закрыть.

## Авторы (графы 2, 7, 7А заявления)

profile.authors — массив. По КАЖДОМУ автору нужны:
ФИО, дата рождения, гражданство, ИНН, серия и номер паспорта, адрес места
жительства (с указанием страны), краткое описание творческого вклада.
СНИЛС — при наличии. Первый в списке = заявитель-правообладатель.
Если авторов больше одного — сведения о втором и последующих подаются в
«дополнении к заявлению», лист полей это уже помечает.

Никогда не выдумывай ИНН, паспорт, СНИЛС, ФИО и адреса — только со слов
пользователя.

## Результат — два блока

**Блок 1 «Скопируй в форму Госуслуг»**: таблица gosuslugi.fields (графы 1, 3, 4, 5
и сведения для реферата) + gosuslugi.applicant (графы 2, 7, 7А по каждому автору),
затем текст реферата со счётчиком referatLen/900.

**Блок 2 «Скачай и приложи»**: documents — название, ссылка downloadUrl (она уже
абсолютная), число листов и экземпляров для графы 9 заявления.

Другие файлы (свидетельство, доп. материалы) грузятся инструментом
upload_material {id, path, kind}: kind = rights для свидетельства и правовых
документов, dep_<категория> для материалов подачи.

## Что важно знать пользователю

- Подача автоматически невозможна: API у Роспатента нет. Финальный шаг человек
  делает сам на Госуслугах/ФИПС.
- Заявка в электронной форме подписывается УСИЛЕННОЙ КВАЛИФИЦИРОВАННОЙ подписью
  (п. 7 Правил, приказ Минэкономразвития № 211). Подтверждённой учётной записи
  недостаточно; физлицу проще всего получить УКЭП через приложение «Госключ».
- Госпошлина — 5000 ₽ за рассмотрение заявки (ст. 333.30 НК с 01.01.2025),
  без скидки за электронную подачу.
- Реферат ограничен 900 знаками и обязан завершаться языком программирования
  и объёмом в байтах — платформа делает это сама.
- После получения свидетельства пользователь вносит его номер и дату на
  платформе (панель «Право на программу»).

## Правила

- Только MCP-инструменты. Кода платформы не касайся, в её базу напрямую не лезь.
- Не создавай продукты «на пробу»: сначала спроси, для какого проекта.
- Если чего-то не хватает — спроси, а не подставляй правдоподобное.
`;
}

function register(router) {
  router.get("/api/client.zip", (req, res) => {
    const url = publicUrl(req);
    const zip = buildZip([
      { name: "mcp/server.js", data: fs.readFileSync(MCP_SERVER_FILE) },
      { name: "mcp/selftest.js", data: fs.readFileSync(MCP_SELFTEST_FILE) },
      { name: ".mcp.json", data: Buffer.from(mcpJson(url), "utf8") },
      { name: "CLAUDE.md", data: Buffer.from(claudeMd(url), "utf8") },
      { name: "README-установка.md", data: Buffer.from(readme(url), "utf8") },
    ]);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": zip.length,
      "Content-Disposition": 'attachment; filename="reestr-mcp.zip"',
    });
    res.end(zip);
  });

  // Метаданные для онбординг-экрана (без пароля).
  router.get("/api/client", (req, res) => {
    sendJson(res, 200, { url: publicUrl(req).replace(/\/\/[^@/]+@/, "//") });
  });
}

module.exports = { register };
