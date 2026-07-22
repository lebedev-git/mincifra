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
        env: { PLATFORM_URL: url, REESTR_CLIENT_NAME: "впиши-своё-имя" },
      },
    },
  }, null, 2) + "\n";
}

function readme(url) {
  const safe = url.replace(/\/\/[^@/]+@/, "//");
  return `# reestr-platform — подключение Claude к платформе

Тонкий клиент: логика и данные живут на сервере (${safe}).

## Нужно
- Node.js 18+ (проверка: node -v; нет — https://nodejs.org, LTS)
- Claude Code

## Установка
1. Распакуй архив, например в C:\\reestr-mcp (Windows) или ~/reestr-mcp.
2. Открой .mcp.json и впиши своё имя в REESTR_CLIENT_NAME (видно в ленте платформы).
3. Подключи (один из способов):
   а) скопируй .mcp.json И папку mcp/ в корень рабочей папки Claude Code;
   б) глобально: claude mcp add reestr-platform --env "PLATFORM_URL=${url}" --env "REESTR_CLIENT_NAME=Имя" -- node "ПУТЬ\\к\\mcp\\server.js"
4. Перезапусти Claude.

## Проверка
Скажи Claude: «список продуктов через reestr-platform». Вернулся список — работает,
и на дашборде платформы появится «Имя — подключён».

## Как работать
Говори словами: «создай продукт X», «подготовь к Роспатенту по git-ссылке …»,
«прогони проверки». Готовые .docx скачиваются на дашборде платформы.

Важно: prepare_rospatent читает проект НА СЕРВЕРЕ — давай git-URL репозитория,
либо загрузи ZIP через веб-интерфейс.
`;
}

function register(router) {
  router.get("/api/client.zip", (req, res) => {
    const url = publicUrl(req);
    const zip = buildZip([
      { name: "mcp/server.js", data: fs.readFileSync(MCP_SERVER_FILE) },
      { name: ".mcp.json", data: Buffer.from(mcpJson(url), "utf8") },
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
