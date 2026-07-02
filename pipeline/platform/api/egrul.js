"use strict";
// API автозаполнения по ИНН (DaData). GET status — включено ли (для UI);
// POST lookup — вернуть реквизиты по ИНН. Ключ живёт только на сервере.

const egrul = require("../core/egrul");
const { readJsonBody, sendJson } = require("../core/http-util");

function register(router) {
  router.get("/api/egrul/status", (req, res) => {
    sendJson(res, 200, { enabled: egrul.isEnabled() });
  });

  router.post("/api/egrul/lookup", async (req, res) => {
    const body = await readJsonBody(req);
    const data = await egrul.lookupByInn(body.inn);
    sendJson(res, 200, { data });
  });
}

module.exports = { register };
