"use strict";
// API карточек продуктов (CRUD). Создание — из шаблона product.example.json.

const fs = require("fs");
const path = require("path");
const store = require("../core/store");
const tracker = require("../core/tracker");
const rights = require("../core/rights");
const { cardCompleteness } = require("../core/readiness");
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

// Вливает значения единого профиля правообладателя в карточку поверх шаблона.
// Профиль — источник значений по умолчанию: заполненные поля профиля перекрывают
// условные примеры шаблона; пустые поля профиля не трогают карточку.
function applyProfile(product, profile) {
  if (!profile) return product;
  const merge = (target, src) => {
    for (const [k, v] of Object.entries(src || {})) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        target[k] = target[k] || {};
        merge(target[k], v);
      } else if (v !== "" && v !== null && v !== undefined) {
        target[k] = v;
      }
    }
  };
  product.rightholder = product.rightholder || {};
  product.support = product.support || {};
  if (profile.rightholder) merge(product.rightholder, profile.rightholder);
  if (profile.support) {
    merge(product.support, profile.support);
    // Собираем единую строку контактов ТП из раздельных полей — её используют
    // модуль подачи (submission.js) и генерация досье, не знающие о новых полях.
    product.support.contactsRu = joinContacts(product.support);
  }
  return product;
}

// ФИО · email · телефон → одна строка (для обратной совместимости support.contactsRu).
function joinContacts(support) {
  const s = support || {};
  const parts = [s.contactFio, s.contactEmail, s.contactPhone].map((x) => (x || "").trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : (s.contactsRu || "");
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
    rightsState: rights.computeState(product),
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
    // Реквизиты правообладателя и контакты ТП — из единого профиля (заполняется один раз).
    applyProfile(template, store.getProfile());
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
    // Вычисляемый статус права (read-model, в БД не пишется) — единый источник core/rights.js.
    const state = rights.computeState(product);
    sendJson(res, 200, { id: req.params.id, product, rights: { state, meta: rights.stateMeta(state) } });
  });

  // Полнота карточки (какие обязательные поля ещё не заполнены) — питает шаг-индикатор в UI.
  // Не дублирует бизнес-логику: только читает уже существующий readiness.cardCompleteness.
  router.get("/api/products/:id/readiness", (req, res) => {
    const product = store.getProduct(req.params.id);
    sendJson(res, 200, { readiness: cardCompleteness(product) });
  });

  router.put("/api/products/:id", async (req, res) => {
    const body = await readJsonBody(req);
    const product = body.product || body; // допускаем и {product:{...}}, и голый объект
    // Держим сводную строку контактов ТП в актуальном виде для модуля подачи и досье.
    if (product && product.support) product.support.contactsRu = joinContacts(product.support);
    const saved = store.saveProduct(req.params.id, product);
    sendJson(res, 200, { id: req.params.id, product: saved });
  });

  router.delete("/api/products/:id", (req, res) => {
    store.deleteProduct(req.params.id);
    sendJson(res, 200, { ok: true });
  });
}

module.exports = { register, summary };
