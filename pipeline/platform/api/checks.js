"use strict";
// API проверок готовности. POST — запустить, GET — последний отчёт.

const store = require("../core/store");
const checksAdapter = require("../core/checks-adapter");
const { sendJson } = require("../core/http-util");

function register(router) {
  // ?live=1 — добавить живую HTTP-проверку страницы продукта (реальный запрос
  // в сеть из этого окружения). Без параметра — как раньше, полностью офлайн.
  router.post("/api/products/:id/checks", async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const live = url.searchParams.get("live") === "1";
    const report = await checksAdapter.runForProduct(req.params.id, { live });
    sendJson(res, 200, { report });
  });

  router.get("/api/products/:id/report", (req, res) => {
    const report = store.getReport(req.params.id);
    sendJson(res, 200, { report });
  });
}

module.exports = { register };
