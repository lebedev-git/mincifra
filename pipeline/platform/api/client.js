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
  return `# Подключение Claude к платформе реестра ПО

Сервер: ${safe}. Всё делает Claude — вам нужно 3 шага.

1. Распакуйте архив, например в C:\\reestr-mcp (Windows) или ~/reestr-mcp.
   Нужен Node.js 18+ (проверка: node -v; нет — https://nodejs.org, LTS).
2. Запустите Claude Code ИЗ ЭТОЙ ПАПКИ — подключение подхватится само
   (адрес уже вписан в .mcp.json). При желании впишите там своё имя
   в REESTR_CLIENT_NAME — оно видно на дашборде платформы.
3. Скажите Claude: «старт».

Дальше Claude сам: представится платформе, покажет продукты, спросит
что готовить и соберёт документы для Роспатента. Готовые .docx —
на дашборде платформы (${safe}).
`;
}

// Инструкция для самого Claude: лежит в корне распакованной папки, Claude Code
// читает её автоматически. Слово «старт» запускает процедуру.
function claudeMd(url) {
  const safe = url.replace(/\/\/[^@/]+@/, "//");
  return `# Платформа подготовки к реестру российского ПО

Ты подключён к платформе (${safe}) через MCP-сервер reestr-platform.
Общайся с пользователем по-русски.

## Фраза «старт»

Когда пользователь пишет «старт» (или просит начать), выполни по порядку:

1. Вызови list_products — покажи продукты и готовность (percent).
2. Вызови get_profile — если профиль автора пуст (нет ФИО/СНИЛС/адреса),
   спроси у пользователя данные автора-физлица и сохрани через set_profile.
   Это нужно для заявления в Роспатент.
3. Спроси, какой продукт готовим (или создать новый) и попроси git-ссылку
   на репозиторий проекта.
4. Вызови prepare_rospatent {source: git-URL, productId?} — он сделает
   снимок версии, фрагмент кода, реферат и вернёт готовые поля формы
   Госуслуг + список .docx.
5. Покажи пользователю: поля формы «Сведения о программе», реферат,
   и скажи, что документы можно скачать на дашборде платформы (${safe}).
6. Если в ответе missing что-то есть — реши это с пользователем.

## Правила

- Проект читает СЕРВЕР платформы: source = git-URL (локальные пути
  пользователя серверу не видны).
- Поля-факты (СНИЛС, УКЭП, ЕСИА, долги ЕНС) не выдумывай — только со слов
  пользователя.
- Коды классов ПО пользователь сверяет по reestr.digital.gov.ru.
`;
}

function register(router) {
  router.get("/api/client.zip", (req, res) => {
    const url = publicUrl(req);
    const zip = buildZip([
      { name: "mcp/server.js", data: fs.readFileSync(MCP_SERVER_FILE) },
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
