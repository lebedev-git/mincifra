"use strict";
// Data-слой платформы: репозиторий на встроенном SQLite (node:sqlite).
// ЕДИНАЯ ТОЧКА доступа к данным — остальной код не знает, где они лежат.
//
// В БД (<DATA_DIR>/reestr.db):
//   products(id, data)     — карточка продукта (JSON в TEXT)
//   reports(product_id, data) — последний отчёт проверок (JSON)
//   profile(id=1, data)    — единый профиль правообладателя (JSON)
//
// На диске (бинарь читается адаптерами/checks по путям, в БД не переносится):
//   <DATA_DIR>/products/<id>/artifacts/<file>   — SBOM/HAR/dep_*
//   <DATA_DIR>/products/<id>/dossier/<file>.docx — сгенерированные документы
//
// При первом старте, если БД пуста, данные из старой файловой раскладки
// (product.json/report.json/profile.json) переносятся в БД автоматически.

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const PLATFORM_DIR = path.resolve(__dirname, "..");
const DATA_DIR = process.env.REESTR_DATA_DIR
  ? path.resolve(process.env.REESTR_DATA_DIR)
  : path.join(PLATFORM_DIR, "data");
const PRODUCTS_DIR = path.join(DATA_DIR, "products");
const DB_FILE = path.join(DATA_DIR, "reestr.db");

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function productDir(id) { return path.join(PRODUCTS_DIR, id); }

// --- Инициализация БД (ленивая, единожды) ---
let _db = null;
function db() {
  if (_db) return _db;
  ensureDir(DATA_DIR);
  _db = new DatabaseSync(DB_FILE);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (product_id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, product_id TEXT
    );
    CREATE TABLE IF NOT EXISTS presence (
      actor TEXT PRIMARY KEY, client TEXT, last_seen TEXT NOT NULL
    );
  `);
  migrateFromFiles(_db);
  return _db;
}

// Разовый перенос старой файловой раскладки в БД (если БД ещё пуста).
function migrateFromFiles(d) {
  const count = d.prepare("SELECT COUNT(*) AS c FROM products").get().c;
  if (count > 0) return;
  if (!fs.existsSync(PRODUCTS_DIR)) {
    // Продуктов нет — перенесём только профиль, если был файл.
    migrateProfile(d);
    return;
  }
  const insP = d.prepare("INSERT OR IGNORE INTO products (id, data) VALUES (?, ?)");
  const insR = d.prepare("INSERT OR IGNORE INTO reports (product_id, data) VALUES (?, ?)");
  let moved = 0;
  for (const id of fs.readdirSync(PRODUCTS_DIR)) {
    const pj = path.join(productDir(id), "product.json");
    if (!fs.existsSync(pj)) continue;
    const product = readJson(pj, null);
    if (!product) continue;
    insP.run(id, JSON.stringify(product));
    const rj = path.join(productDir(id), "report.json");
    if (fs.existsSync(rj)) {
      const rep = readJson(rj, null);
      if (rep) insR.run(id, JSON.stringify(rep));
    }
    moved++;
  }
  migrateProfile(d);
  if (moved) console.log(`[store] Миграция: перенесено продуктов в SQLite — ${moved}`);
}
function migrateProfile(d) {
  const legacy = path.join(DATA_DIR, "profile.json");
  if (!fs.existsSync(legacy)) return;
  const prof = readJson(legacy, null);
  if (!prof) return;
  d.prepare("INSERT OR IGNORE INTO profile (id, data) VALUES (1, ?)").run(JSON.stringify(prof));
}

// --- Утилиты ---
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (_) { return fallback; }
}
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}
// Простой безопасный id из имени + детерминированный суффикс (без внешних библиотек).
function makeId(name) {
  const base = String(name || "product")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "product";
  const total = db().prepare("SELECT COUNT(*) AS c FROM products").get().c;
  const suffix = Math.abs(hashStr(base + ":" + total)).toString(36).slice(0, 4);
  let id = `${base}-${suffix}`;
  let n = 1;
  while (productExists(id)) id = `${base}-${suffix}${n++}`;
  return id;
}
function productExists(id) {
  return !!db().prepare("SELECT 1 FROM products WHERE id = ?").get(id);
}

// Валидация id — защита от path traversal (артефакты/dossier на диске).
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

// --- Профиль правообладателя (единый на всю установку) ---
function getProfile() {
  const row = db().prepare("SELECT data FROM profile WHERE id = 1").get();
  const prof = row ? JSON.parse(row.data) : {};
  // Авторов может быть несколько (графа 7 заявления). Прежний единственный
  // author.* остаётся первым в списке — старые профили читаются без миграции.
  if (!Array.isArray(prof.authors)) {
    prof.authors = (prof.author && prof.author.fullName) ? [prof.author] : [];
  }
  prof.author = prof.authors[0] || {};
  return prof;
}
function saveProfile(profile) {
  db().prepare(
    "INSERT INTO profile (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data"
  ).run(JSON.stringify(profile || {}));
  return getProfile();
}

// --- Продукты ---
function listProducts() {
  return db().prepare("SELECT id, data FROM products").all()
    .map((r) => ({ id: r.id, product: JSON.parse(r.data) }));
}
function getProduct(id) {
  safeId(id);
  const row = db().prepare("SELECT data FROM products WHERE id = ?").get(id);
  if (!row) throw httpError(404, "Продукт не найден");
  return JSON.parse(row.data);
}
function createProduct(product, name) {
  const id = makeId(name || (product.product && product.product.shortName));
  db().prepare("INSERT INTO products (id, data) VALUES (?, ?)").run(id, JSON.stringify(product));
  ensureDir(productDir(id)); // каталог под будущие артефакты/dossier
  return id;
}
function saveProduct(id, product) {
  safeId(id);
  if (!productExists(id)) throw httpError(404, "Продукт не найден");
  db().prepare("UPDATE products SET data = ? WHERE id = ?").run(JSON.stringify(product), id);
  return product;
}
function deleteProduct(id) {
  safeId(id);
  if (!productExists(id)) throw httpError(404, "Продукт не найден");
  db().prepare("DELETE FROM products WHERE id = ?").run(id);
  db().prepare("DELETE FROM reports WHERE product_id = ?").run(id);
  const dir = productDir(id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// --- Отчёт проверок ---
function saveReport(id, report) {
  safeId(id);
  db().prepare(
    "INSERT INTO reports (product_id, data) VALUES (?, ?) ON CONFLICT(product_id) DO UPDATE SET data = excluded.data"
  ).run(id, JSON.stringify(report));
  return report;
}
function getReport(id) {
  safeId(id);
  const row = db().prepare("SELECT data FROM reports WHERE product_id = ?").get(id);
  return row ? JSON.parse(row.data) : null;
}

// --- Артефакты (SBOM/HAR/dep_*) — файлы на диске ---
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
function artifactsDir(id) {
  safeId(id);
  return path.join(productDir(id), "artifacts");
}
function listArtifacts(id) {
  safeId(id);
  const dir = path.join(productDir(id), "artifacts");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => ({
    name: f, size: fs.statSync(path.join(dir, f)).size,
  }));
}

// --- Досье (.docx) — файлы на диске ---
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

// --- Активность и присутствие (MCP-first дашборд) ---
// activity — лента действий («кто-когда-что»), presence — последний сигнал клиента.
// actor приходит из заголовка агента (X-Reestr-Client) либо "веб" для браузера.
const ACTIVITY_KEEP = 500; // хвост ленты, старое подрезаем — БД не растёт бесконечно

function logActivity(actor, action, productId) {
  const d = db();
  d.prepare("INSERT INTO activity (ts, actor, action, product_id) VALUES (?, ?, ?, ?)")
    .run(new Date().toISOString(), String(actor || "веб"), String(action), productId || null);
  d.prepare(
    "DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT ?)"
  ).run(ACTIVITY_KEEP);
}
function listActivity(limit = 50) {
  return db().prepare("SELECT ts, actor, action, product_id FROM activity ORDER BY id DESC LIMIT ?")
    .all(Number(limit) || 50);
}
function touchPresence(actor, client) {
  db().prepare(
    "INSERT INTO presence (actor, client, last_seen) VALUES (?, ?, ?) " +
    "ON CONFLICT(actor) DO UPDATE SET client = excluded.client, last_seen = excluded.last_seen"
  ).run(String(actor), client || null, new Date().toISOString());
}
function listPresence() {
  return db().prepare("SELECT actor, client, last_seen FROM presence ORDER BY last_seen DESC").all();
}

module.exports = {
  DATA_DIR, PRODUCTS_DIR, DB_FILE, productDir,
  getProfile, saveProfile,
  listProducts, getProduct, createProduct, saveProduct, deleteProduct,
  saveArtifact, artifactPath, artifactsDir, listArtifacts,
  saveReport, getReport,
  logActivity, listActivity, touchPresence, listPresence,
  dossierDir, listDossier, dossierFilePath,
  httpError,
};
