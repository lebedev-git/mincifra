"use strict";
// API активности: «кто подключён» и «кто что сделал» (MCP-first дашборд).
//
//   POST /api/hello            — сигнал клиента: {client} + заголовок X-Reestr-Client
//   GET  /api/activity         — { connections: [...], feed: [...] }
//
// «Подключён» = был сигнал/действие за последние ACTIVE_WINDOW_MS. MCP-обёртка
// шлёт hello при старте и помечает каждый вызов заголовком; браузер — actor «веб».

const store = require("../core/store");
const { readJsonBody, sendJson } = require("../core/http-util");

const ACTIVE_WINDOW_MS = 10 * 60 * 1000; // 10 минут без сигнала → «не активен»

function actorOf(req) {
  const h = req.headers["x-reestr-client"];
  if (!h) return "веб";
  let s = String(h);
  try { s = decodeURIComponent(s); } catch (_) { /* оставляем как есть */ }
  return s.trim().slice(0, 64) || "веб";
}

function register(router) {
  router.post("/api/hello", async (req, res) => {
    const body = await readJsonBody(req).catch(() => ({}));
    // Заголовок надёжнее тела: он percent-encoded (ASCII), кодировка не бьётся.
    const fromHeader = actorOf(req);
    const actor = fromHeader !== "веб" ? fromHeader
      : (body.name && String(body.name).trim().slice(0, 64)) || "веб";
    store.touchPresence(actor, body.client || null);
    sendJson(res, 200, { ok: true, actor });
  });

  router.get("/api/activity", (req, res) => {
    const now = Date.now();
    const connections = store.listPresence().map((p) => ({
      actor: p.actor,
      client: p.client,
      lastSeen: p.last_seen,
      active: now - Date.parse(p.last_seen) < ACTIVE_WINDOW_MS,
    }));
    sendJson(res, 200, { connections, feed: store.listActivity(50) });
  });
}

module.exports = { register, actorOf };
