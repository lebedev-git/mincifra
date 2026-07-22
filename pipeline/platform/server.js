"use strict";
// Точка входа платформы: http-сервер (встроенный node:http), маршрутизация API
// и отдача статического фронтенда из web/. Без внешних зависимостей.
//
// Запуск:   node server.js         (или npm start)
// Порт:     env PORT (по умолчанию 3000)
// Данные:   env REESTR_DATA_DIR (по умолчанию platform/data)

const http = require("http");
const fs = require("fs");
const path = require("path");

const { Router } = require("./core/router");
const { sendError, sendFile, errWithStatus } = require("./core/http-util");

const WEB_DIR = path.join(__dirname, "web");
const PORT = Number(process.env.PORT) || 3000;

// --- Сборка роутера из API-модулей ---
const router = new Router();
[
  require("./api/products"),
  require("./api/artifacts"),
  require("./api/checks"),
  require("./api/docs"),
  require("./api/tracker"),
  require("./api/submission"),
  require("./api/rospatent"),
  require("./api/reference"),
  require("./api/egrul"),
  require("./api/profile"),
  require("./api/prepare"),
].forEach((m) => m.register(router));

// --- Отдача статики (web/) ---
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.join(WEB_DIR, path.normalize(rel));
  // Защита от выхода за пределы web/. Разделитель обязателен, иначе соседний
  // каталог-«сосед» (напр. web-backup) прошёл бы проверку по префиксу.
  if (file !== WEB_DIR && !file.startsWith(WEB_DIR + path.sep)) {
    sendError(res, errWithStatus(403, "Запрещено")); return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) { sendFile(res, file); return; }
  // SPA-фолбэк: неизвестный не-API путь → index.html
  sendFile(res, path.join(WEB_DIR, "index.html"));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      const hit = router.match(req.method, pathname);
      if (!hit) { sendError(res, errWithStatus(404, `Маршрут не найден: ${req.method} ${pathname}`)); return; }
      req.params = hit.params;
      await hit.handler(req, res, hit.params);
      return;
    }
    if (req.method !== "GET") { sendError(res, errWithStatus(405, "Метод не поддерживается")); return; }
    serveStatic(req, res, pathname);
  } catch (err) {
    sendError(res, err);
  }
});

server.listen(PORT, () => {
  const store = require("./core/store");
  console.log("═══ Платформа реестра ПО запущена ═══");
  console.log(`  URL:     http://localhost:${PORT}`);
  console.log(`  Данные:  ${store.DATA_DIR}`);
  console.log("  Остановка: Ctrl+C");
});
