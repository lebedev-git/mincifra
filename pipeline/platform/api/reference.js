"use strict";
// API справочников (read-only). Классификатор классов ПО — источник истины
// 99_reference/software_classes.json. Кэшируется в памяти при первом обращении.

const fs = require("fs");
const path = require("path");
const { sendJson, sendText, sendError, errWithStatus, readJsonBody } = require("../core/http-util");
const classHint = require("../core/class_hint");

const CLASSES_PATH = path.resolve(__dirname, "../../99_reference/software_classes.json");
// Глоссарий — единый источник: файл pipeline/ГЛОССАРИЙ.md (не дублируем текст в UI).
const GLOSSARY_PATH = path.resolve(__dirname, "../../ГЛОССАРИЙ.md");
// Нормативный справочник — единый источник: pipeline/99_reference/normative.md.
const NORMATIVE_PATH = path.resolve(__dirname, "../../99_reference/normative.md");
// Источники/ссылки — единый источник: pipeline/99_reference/sources.md.
const SOURCES_PATH = path.resolve(__dirname, "../../99_reference/sources.md");
let _classesCache = null;
let _glossaryCache = null;
let _normativeCache = null;
let _sourcesCache = null;

function loadClasses() {
  if (_classesCache) return _classesCache;
  _classesCache = JSON.parse(fs.readFileSync(CLASSES_PATH, "utf8"));
  return _classesCache;
}

function loadGlossary() {
  if (_glossaryCache != null) return _glossaryCache;
  _glossaryCache = fs.readFileSync(GLOSSARY_PATH, "utf8");
  return _glossaryCache;
}

function loadNormative() {
  if (_normativeCache != null) return _normativeCache;
  _normativeCache = fs.readFileSync(NORMATIVE_PATH, "utf8");
  return _normativeCache;
}

function loadSources() {
  if (_sourcesCache != null) return _sourcesCache;
  _sourcesCache = fs.readFileSync(SOURCES_PATH, "utf8");
  return _sourcesCache;
}

function register(router) {
  router.get("/api/reference/classes", (req, res) => {
    sendJson(res, 200, loadClasses());
  });

  // Подсказка класса ПО по тексту (описание + назначение). Детерминированно,
  // без сети — сужает 12 верхнеуровневых классов до кандидатов по ключевым словам.
  router.post("/api/reference/suggest-class", async (req, res) => {
    const body = await readJsonBody(req);
    const suggestions = classHint.suggestClasses(body.text);
    sendJson(res, 200, { suggestions });
  });
  router.get("/api/reference/glossary", (req, res) => {
    try { sendText(res, 200, loadGlossary(), "text/markdown; charset=utf-8"); }
    catch (e) { sendError(res, errWithStatus(404, "Глоссарий не найден")); }
  });

  // Нормативный справочник (ПП №1236/325, изменения 2026 г. и т.д.) — read-only,
  // рендерится на фронте по разделам (см. viewNormative в web/app.js).
  router.get("/api/reference/normative", (req, res) => {
    try { sendText(res, 200, loadNormative(), "text/markdown; charset=utf-8"); }
    catch (e) { sendError(res, errWithStatus(404, "Нормативный справочник не найден")); }
  });

  // Собранные ссылки на документацию (портал, ПП №1236, гайды) — read-only markdown.
  router.get("/api/reference/sources", (req, res) => {
    try { sendText(res, 200, loadSources(), "text/markdown; charset=utf-8"); }
    catch (e) { sendError(res, errWithStatus(404, "Источники не найдены")); }
  });
}

module.exports = { register };
