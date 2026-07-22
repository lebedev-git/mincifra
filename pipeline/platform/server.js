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
const store = require("./core/store");
const { actorOf } = require("./api/activity");

const WEB_DIR = path.join(__dirname, "web");
const PORT = Number(process.env.PORT) || 3000;
// HOST=127.0.0.1 — слушать только localhost (за nginx-прокси). По умолчанию все интерфейсы.
const HOST = process.env.HOST || "0.0.0.0";

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
  require("./api/activity"),
  require("./api/client"),
].forEach((m) => m.register(router));

// --- Лента действий: человекочитаемые события по method+path ---
// Центральная точка (а не правки в каждом api-модуле): смотрим на маршрут ПОСЛЕ
// успешного ответа. Только значимые действия — GET-чтение в ленту не пишем.
const ACTIVITY_RULES = [
  [/^POST \/api\/products$/, "создал продукт"],
  [/^PUT \/api\/products\/([^/]+)$/, "обновил карточку"],
  [/^DELETE \/api\/products\/([^/]+)$/, "удалил продукт"],
  [/^POST \/api\/products\/([^/]+)\/checks$/, "прогнал проверки"],
  [/^POST \/api\/products\/([^/]+)\/autofill/, "загрузил проект (снимок кода)"],
  [/^POST \/api\/products\/([^/]+)\/prepare$/, "загрузил проект по git-ссылке"],
  [/^POST \/api\/products\/([^/]+)\/depon\/(\w+)$/, "сформировал документ Роспатента"],
  [/^POST \/api\/products\/([^/]+)\/assign\/(\w+)$/, "сформировал документ отчуждения"],
  [/^POST \/api\/products\/([^/]+)\/dossier$/, "сгенерировал досье"],
  [/^POST \/api\/products\/([^/]+)\/rospatent\/autofill$/, "собрал монтажный лист Роспатента"],
  [/^PUT \/api\/products\/([^/]+)\/artifacts\/(\w+)/, "загрузил артефакт"],
  [/^PUT \/api\/profile$/, "обновил профиль"],
];
function logIfSignificant(req, pathname) {
  const key = `${req.method} ${pathname}`;
  for (const [rx, text] of ACTIVITY_RULES) {
    const m = key.match(rx);
    if (m) {
      const productId = m[1] ? decodeURIComponent(m[1]) : null;
      try { store.logActivity(actorOf(req), text, productId); } catch (_) { /* лента не критична */ }
      return;
    }
  }
}

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
      // Успешный значимый вызов → лента + отметка присутствия (обёртка MCP шлёт
      // X-Reestr-Client; браузер идёт как «веб» и присутствие не засоряет).
      if (res.statusCode < 400) {
        logIfSignificant(req, pathname);
        if (req.headers["x-reestr-client"]) {
          try { store.touchPresence(actorOf(req), null); } catch (_) { /* не критично */ }
        }
      }
      return;
    }
    if (req.method !== "GET") { sendError(res, errWithStatus(405, "Метод не поддерживается")); return; }
    serveStatic(req, res, pathname);
  } catch (err) {
    sendError(res, err);
  }
});

server.listen(PORT, HOST, () => {
  const store = require("./core/store");
  console.log("═══ Платформа реестра ПО запущена ═══");
  console.log(`  URL:     http://localhost:${PORT}`);
  console.log(`  Данные:  ${store.DATA_DIR}`);
  console.log("  Остановка: Ctrl+C");
});
