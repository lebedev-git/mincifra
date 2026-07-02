"use strict";
// API справочников (read-only). Классификатор классов ПО — источник истины
// 99_reference/software_classes.json. Кэшируется в памяти при первом обращении.

const fs = require("fs");
const path = require("path");
const { sendJson } = require("../core/http-util");

const CLASSES_PATH = path.resolve(__dirname, "../../99_reference/software_classes.json");
let _classesCache = null;

function loadClasses() {
  if (_classesCache) return _classesCache;
  _classesCache = JSON.parse(fs.readFileSync(CLASSES_PATH, "utf8"));
  return _classesCache;
}

function register(router) {
  router.get("/api/reference/classes", (req, res) => {
    sendJson(res, 200, loadClasses());
  });
}

module.exports = { register };
