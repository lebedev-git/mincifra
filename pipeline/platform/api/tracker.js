"use strict";
// API маршрута подготовки. GET — стадии с готовностью (проекция данных).
// Ручных отметок нет: статус пунктов вычисляется из карточки/отчёта/артефактов,
// поэтому PUT отсутствует — чтобы что-то «закрыть», надо заполнить данные.

const tracker = require("../core/tracker");
const { sendJson } = require("../core/http-util");

function register(router) {
  router.get("/api/products/:id/tracker", (req, res) => {
    sendJson(res, 200, { tracker: tracker.buildTracker(req.params.id) });
  });
}

module.exports = { register };
