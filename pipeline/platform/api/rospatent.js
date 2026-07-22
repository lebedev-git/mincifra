"use strict";
// API монтажного листа «Госрегистрация ПрЭВМ» (Госуслуги / ФИПС):
// готовые значения полей формы «Сведения о программе» + реферат ≤ 900 символов.

const rospatent = require("../core/rospatent");
const { sendJson } = require("../core/http-util");

function register(router) {
  router.get("/api/products/:id/rospatent", (req, res) => {
    sendJson(res, 200, { rospatent: rospatent.buildGosuslugi(req.params.id) });
  });

  // «Заполнить автоматически» — пишет выводимые поля в карточку и возвращает лист.
  router.post("/api/products/:id/rospatent/autofill", (req, res) => {
    sendJson(res, 200, { rospatent: rospatent.autofill(req.params.id) });
  });
}

module.exports = { register };
