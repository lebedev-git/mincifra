"use strict";
// Data-слой платформы: файловый репозиторий продуктов.
// ЕДИНАЯ ТОЧКА ЗАМЕНЫ на БД (PostgreSQL) при переезде на сервер — весь остальной
// код обращается к данным только через этот интерфейс, не зная о файлах.
//
// Раскладка на диске (создаётся автоматически):
//   <DATA_DIR>/products/<id>/product.json      — карточка продукта
//   <DATA_DIR>/products/<id>/tracker.json       — статусы гейтов
//   <DATA_DIR>/products/<id>/report.json        — последний отчёт проверок
//   <DATA_DIR>/products/<id>/artifacts/<file>   — SBOM/HAR
//   <DATA_DIR>/products/<id>/dossier/<file>.docx— сгенерированные документы

const fs = require("fs");
const path = require("path");

const PLATFORM_DIR = path.resolve(__dirname, "..");
const DATA_DIR = process.env.REESTR_DATA_DIR
  ? path.resolve(process.env.REESTR_DATA_DIR)
  : path.join(PLATFORM_DIR, "data");
const PRODUCTS_DIR = path.join(DATA_DIR, "products");

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function productDir(id) { return path.join(PRODUCTS_DIR, id); }

// Простой безопасный id из имени + случайный суффикс (без внешних библиотек).
function makeId(name) {
  const base = String(name || "product")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "product";
  const suffix = Math.abs(hashStr(base + ":" + Object.keys(listRaw()).length)).toString(36).slice(0, 4);
  let id = `${base}-${suffix}`;
  let n = 1;
  while (fs.existsSync(productDir(id))) id = `${base}-${suffix}${n++}`;
  return id;
}
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

// Валидация id — защита от path traversal.
function safeId(id) {
  if (!/^[a-z0-9а-яё][a-z0-9а-яё-]{0,63}$/i.test(String(id))) throw httpError(400, "Некорректный id продукта");
  return id;
}
function safeFile(name) {
  const base = path.basename(String(name));
  if (base !== String(name) || base.includes("..")) throw httpError(400, "Некорректное имя файла");
  return base;
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (_) { return fallback; }
}
function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

function listRaw() {
  ensureDir(PRODUCTS_DIR);
  const out = {};
  for (const id of fs.readdirSync(PRODUCTS_DIR)) {
    const pj = path.join(productDir(id), "product.json");
    if (fs.existsSync(pj)) out[id] = readJson(pj, null);
  }
  return out;
}

// --- Публичный интерфейс репозитория ---

function listProducts() {
  const raw = listRaw();
  return Object.keys(raw).map((id) => ({ id, product: raw[id] }));
}

function getProduct(id) {
  safeId(id);
  const pj = path.join(productDir(id), "product.json");
  if (!fs.existsSync(pj)) throw httpError(404, "Продукт не найден");
  return readJson(pj, null);
}

function createProduct(product, name) {
  const id = makeId(name || (product.product && product.product.shortName));
  ensureDir(productDir(id));
  writeJson(path.join(productDir(id), "product.json"), product);
  return id;
}

function saveProduct(id, product) {
  safeId(id);
  if (!fs.existsSync(productDir(id))) throw httpError(404, "Продукт не найден");
  writeJson(path.join(productDir(id), "product.json"), product);
  return product;
}

function deleteProduct(id) {
  safeId(id);
  const dir = productDir(id);
  if (!fs.existsSync(dir)) throw httpError(404, "Продукт не найден");
  fs.rmSync(dir, { recursive: true, force: true });
}

// Артефакты (SBOM/HAR) — произвольные файлы в подкаталоге artifacts.
function saveArtifact(id, name, buffer) {
  safeId(id);
  const file = safeFile(name);
  const dir = path.join(productDir(id), "artifacts");
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, file), buffer);
  return path.join("artifacts", file);
}
function artifactPath(id, name) {
  safeId(id); const file = safeFile(name);
  return path.join(productDir(id), "artifacts", file);
}
function listArtifacts(id) {
  safeId(id);
  const dir = path.join(productDir(id), "artifacts");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => ({
    name: f, size: fs.statSync(path.join(dir, f)).size,
  }));
}

// Отчёт проверок.
function saveReport(id, report) {
  safeId(id);
  writeJson(path.join(productDir(id), "report.json"), report);
  return report;
}
function getReport(id) {
  safeId(id);
  const f = path.join(productDir(id), "report.json");
  return fs.existsSync(f) ? readJson(f, null) : null;
}

// Трекер гейтов.
function saveTracker(id, tracker) {
  safeId(id);
  writeJson(path.join(productDir(id), "tracker.json"), tracker);
  return tracker;
}
function getTracker(id) {
  safeId(id);
  const f = path.join(productDir(id), "tracker.json");
  return fs.existsSync(f) ? readJson(f, null) : null;
}

// Каталог для сгенерированного досье.
function dossierDir(id) {
  safeId(id);
  return path.join(productDir(id), "dossier");
}
function listDossier(id) {
  const dir = dossierDir(id);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".docx")).map((f) => ({
    name: f, size: fs.statSync(path.join(dir, f)).size,
  }));
}
function dossierFilePath(id, name) {
  return path.join(dossierDir(id), safeFile(name));
}

module.exports = {
  DATA_DIR, PRODUCTS_DIR, productDir,
  listProducts, getProduct, createProduct, saveProduct, deleteProduct,
  saveArtifact, artifactPath, listArtifacts,
  saveReport, getReport,
  saveTracker, getTracker,
  dossierDir, listDossier, dossierFilePath,
  httpError,
};
