"use strict";
// API справочников (read-only). Классификатор классов ПО — источник истины
// 99_reference/software_classes.json. Кэшируется в памяти при первом обращении.

const fs = require("fs");
const path = require("path");
const { sendJson, sendText, sendError, errWithStatus } = require("../core/http-util");

const CLASSES_PATH = path.resolve(__dirname, "../../99_reference/software_classes.json");
// Глоссарий — единый источник: файл pipeline/ГЛОССАРИЙ.md (не дублируем текст в UI).
const GLOSSARY_PATH = path.resolve(__dirname, "../../ГЛОССАРИЙ.md");
let _classesCache = null;
let _glossaryCache = null;

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

function register(router) {
  router.get("/api/reference/classes", (req, res) => {
    sendJson(res, 200, loadClasses());
  });
  router.get("/api/reference/glossary", (req, res) => {
    try { sendText(res, 200, loadGlossary(), "text/markdown; charset=utf-8"); }
    catch (e) { sendError(res, errWithStatus(404, "Глоссарий не найден")); }
  });
}

module.exports = { register };
