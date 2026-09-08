"use strict";
// API маршрута подготовки. GET — стадии с готовностью (проекция данных).
// Ручных отметок нет: статус пунктов вычисляется из карточки/отчёта/артефактов,
// поэтому PUT отсутствует — чтобы что-то «закрыть», надо заполнить данные.

const tracker = require("../core/tracker");
const store = require("../core/store");
const criteria = require("../core/criteria");
const { sendJson } = require("../core/http-util");

function register(router) {
  router.get("/api/products/:id/tracker", (req, res) => {
    sendJson(res, 200, { tracker: tracker.buildTracker(req.params.id) });
  });

  // Построчная сверка продукта с ПП № 1236: по каждому пункту — норма, дословный
  // текст требования, статус и чем подтверждается. Это то, что человек несёт на
  // портал, и то, чем проверяется любой продукт, а не только текущий.
  router.get("/api/products/:id/compliance", (req, res) => {
    const id = req.params.id;
    const names = (store.listArtifacts(id) || []).map((a) => a.name);
    sendJson(res, 200, {
      compliance: criteria.evaluate(store.getProduct(id), store.getReport(id), names),
    });
  });
}

module.exports = { register };
