"use strict";
// API трекера гейтов G0–G5. GET — состояние с готовностью, PUT — отметки пунктов.

const tracker = require("../core/tracker");
const { readJsonBody, sendJson } = require("../core/http-util");

function register(router) {
  router.get("/api/products/:id/tracker", (req, res) => {
    sendJson(res, 200, { tracker: tracker.buildTracker(req.params.id) });
  });

  // Тело: { items: { itemId: bool, ... } }
  router.put("/api/products/:id/tracker", async (req, res) => {
    const body = await readJsonBody(req);
    const patch = body.items || body;
    const updated = tracker.updateManual(req.params.id, patch);
    sendJson(res, 200, { tracker: updated });
  });
}

module.exports = { register };
