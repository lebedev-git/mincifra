"use strict";
// API карточек продуктов (CRUD). Создание — из шаблона product.example.json.

const fs = require("fs");
const path = require("path");
const store = require("../core/store");
const tracker = require("../core/tracker");
const { readJsonBody, sendJson } = require("../core/http-util");

const TEMPLATE_PATH = path.resolve(__dirname, "../../product.example.json");

// Рекурсивно убирает служебные ключи-подсказки шаблона (*_note, *_options,
// $schema_note), чтобы они не сохранялись в карточку продукта и не засоряли данные.
// Код (UI, генерация, проверки) на эти ключи не опирается.
function stripHelperKeys(obj) {
  if (Array.isArray(obj)) { obj.forEach(stripHelperKeys); return obj; }
  if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      if (/(_note|_options)$/.test(k) || k === "$schema_note") delete obj[k];
      else stripHelperKeys(obj[k]);
    }
  }
  return obj;
}

function loadTemplate() {
  return stripHelperKeys(JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8")));
}

// Краткая сводка по продукту для дашборда.
function summary(id, product) {
  const t = tracker.buildTracker(id);
  const p = product.product || {};
  return {
    id,
    name: p.name || "(без имени)",
    shortName: p.shortName || "",
    deliveryType: p.deliveryType || "",
    percent: t.percent,
    checksOverall: t.checksOverall,
    hasReport: t.hasReport,
  };
}

function register(router) {
  router.get("/api/products", (req, res) => {
    const list = store.listProducts()
      .filter((x) => x.product)
      .map((x) => summary(x.id, x.product));
    sendJson(res, 200, { products: list });
  });

  router.post("/api/products", async (req, res) => {
    const body = await readJsonBody(req);
    const template = loadTemplate();
    // Позволяем задать имя при создании; остальное — из шаблона (правится в UI).
    if (body.name) {
      template.product = template.product || {};
      template.product.name = body.name;
      template.product.shortName = body.shortName || body.name;
    }
    const id = store.createProduct(template, body.shortName || body.name || (template.product && template.product.shortName));
    sendJson(res, 201, { id, product: template });
  });

  router.get("/api/products/:id", (req, res) => {
    const product = store.getProduct(req.params.id);
    sendJson(res, 200, { id: req.params.id, product });
  });

  router.put("/api/products/:id", async (req, res) => {
    const body = await readJsonBody(req);
    const product = body.product || body; // допускаем и {product:{...}}, и голый объект
    const saved = store.saveProduct(req.params.id, product);
    sendJson(res, 200, { id: req.params.id, product: saved });
  });

  router.delete("/api/products/:id", (req, res) => {
    store.deleteProduct(req.params.id);
    sendJson(res, 200, { ok: true });
  });
}

module.exports = { register, summary };
