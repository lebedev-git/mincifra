"use strict";
// HTTP-утилиты: чтение тела, JSON-ответы, отдача файлов, MIME.
// Без внешних зависимостей — только node:http/fs/path.

const fs = require("fs");
const path = require("path");

const MAX_BODY = 25 * 1024 * 1024; // 25 МБ — HAR/SBOM с запасом

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".zip": "application/zip",
};

function mimeFor(file) { return MIME[path.extname(file).toLowerCase()] || "application/octet-stream"; }

// Собрать тело запроса в Buffer с лимитом.
// maxBytes — необязательный лимит для конкретного маршрута (по умолчанию MAX_BODY = 25 МБ).
// Загрузка снимка проекта (ZIP) шлёт большие тела, поэтому autofill передаёт свой лимит.
function readBody(req, maxBytes = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) { reject(errWithStatus(413, "Тело запроса слишком большое")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString("utf8")); }
  catch (e) { throw errWithStatus(400, "Некорректный JSON в теле запроса"); }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res, err) {
  const status = err && err.status ? err.status : 500;
  if (status >= 500) console.error("[500]", err && err.stack ? err.stack : err);
  sendJson(res, status, { error: (err && err.message) || "Внутренняя ошибка" });
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(text);
}

// Отдать файл с диска (статика или скачивание). download=true → attachment.
function sendFile(res, file, { download = false } = {}) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    sendError(res, errWithStatus(404, "Файл не найден"));
    return;
  }
  const headers = { "Content-Type": mimeFor(file) };
  if (download) {
    // filename* с URL-кодированием — корректно для кириллицы.
    headers["Content-Disposition"] =
      `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

function errWithStatus(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = {
  readBody, readJsonBody, sendJson, sendError, sendText, sendFile, mimeFor, errWithStatus,
};
