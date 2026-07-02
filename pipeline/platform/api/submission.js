"use strict";
// API «монтажного листа подачи»: готовые значения полей для портала.

const submission = require("../core/submission");
const { sendJson } = require("../core/http-util");

function register(router) {
  router.get("/api/products/:id/submission", (req, res) => {
    sendJson(res, 200, { submission: submission.buildSubmission(req.params.id) });
  });
}

module.exports = { register };
