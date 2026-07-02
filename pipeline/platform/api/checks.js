"use strict";
// API проверок готовности. POST — запустить, GET — последний отчёт.

const store = require("../core/store");
const checksAdapter = require("../core/checks-adapter");
const { sendJson } = require("../core/http-util");

function register(router) {
  router.post("/api/products/:id/checks", (req, res) => {
    const report = checksAdapter.runForProduct(req.params.id);
    sendJson(res, 200, { report });
  });

  router.get("/api/products/:id/report", (req, res) => {
    const report = store.getReport(req.params.id);
    sendJson(res, 200, { report });
  });
}

module.exports = { register };
