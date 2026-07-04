"use strict";
// Автосбор HAR headless-браузером вместо ручного F12 → Network → Save all as HAR.
// Заменяет только СБОР файла — сам network_audit.js (02_checks/lib) продолжает
// анализировать результат так же, как HAR, загруженный вручную.
//
// Playwright — опциональная зависимость (как `docx` для генерации документов,
// см. 03_docs/lib/docx_helpers.js): НЕ входит в обязательные зависимости
// платформы, резолвится тем же способом (локально/глобально), а без установки
// даёт понятную ошибку с инструкцией и не ломает остальной инструмент. Причины:
//  1) первая установка тянет и сам Playwright, и браузер Chromium (~150+ МБ) —
//     это должно быть осознанным разовым действием пользователя, не «магией»;
//  2) инструмент остаётся офлайн по умолчанию — сеть нужна только когда явно
//     нажата кнопка «Собрать HAR автоматически», а не при каждом запуске сервера.
//
// Установка (один раз, в каталоге platform/):
//   npm install playwright && npx playwright install chromium

const fs = require("fs");
const os = require("os");
const path = require("path");
const { httpError } = require("./prepare");

const NAV_TIMEOUT_MS = 30 * 1000;

// Находит модуль playwright — тот же порядок кандидатов, что и docx_helpers.js.
function resolvePlaywright() {
  try { return require("playwright"); } catch (_) { /* пробуем глобально */ }

  const { createRequire } = require("module");
  const candidates = [];
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, "npm", "node_modules"));
  if (process.env.npm_config_prefix) candidates.push(path.join(process.env.npm_config_prefix, "node_modules"));
  candidates.push(path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules"));
  candidates.push(path.resolve(path.dirname(process.execPath), "node_modules"));

  for (const root of candidates) {
    try {
      const req = createRequire(path.join(root, "index.js"));
      return req("playwright");
    } catch (_) { /* следующий кандидат */ }
  }

  try {
    const root = require("child_process")
      .execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim();
    if (root) return require("module").createRequire(path.join(root, "index.js"))("playwright");
  } catch (_) { /* не нашли */ }

  return null;
}

// Доступность автосбора для UI (не роняет запрос, если playwright не установлен).
function status() {
  return { available: resolvePlaywright() !== null };
}

function validateUrl(raw) {
  const u = String(raw || "").trim();
  if (!u) throw httpError(400, "Не указан URL страницы продукта (product.productPageUrl).");
  if (!/^https?:\/\//i.test(u)) throw httpError(400, "URL должен быть абсолютным (http/https).");
  return u;
}

// Собирает HAR по URL. Возвращает { harBuffer, hostsCount, warnings }.
async function capture(url) {
  const u = validateUrl(url);
  const playwright = resolvePlaywright();
  if (!playwright) {
    throw httpError(422,
      "Playwright не установлен — автосбор HAR недоступен. Установите один раз: " +
      "npm install playwright && npx playwright install chromium (в каталоге pipeline/platform). " +
      "До установки используйте ручной способ (F12 → Network → Save as HAR).");
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "reestr-har-"));
  const harPath = path.join(work, "out.har");
  const warnings = [];
  let browser;
  try {
    browser = await playwright.chromium.launch();
    const context = await browser.newContext({ recordHar: { path: harPath, mode: "minimal" } });
    const page = await context.newPage();
    try {
      await page.goto(u, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
    } catch (e) {
      // networkidle может не наступить на «живых» SPA (веб-сокеты, поллинг) —
      // не фатально: к моменту таймаута HAR уже частично записан.
      warnings.push(`Страница не «успокоилась» за ${NAV_TIMEOUT_MS / 1000} с (${e.message}) — HAR может быть неполным.`);
    }
    await context.close(); // HAR дописывается на закрытии контекста

    if (!fs.existsSync(harPath)) throw httpError(422, "HAR не был записан — страница недоступна из этого окружения.");
    const harBuffer = fs.readFileSync(harPath);

    let hostsCount = null;
    try {
      const parsed = JSON.parse(harBuffer.toString("utf8"));
      const hosts = new Set();
      for (const e of (parsed.log && parsed.log.entries) || []) {
        try { hosts.add(new URL(e.request.url).hostname); } catch (_) { /* пропускаем битый URL */ }
      }
      hostsCount = hosts.size;
    } catch (_) { /* не критично — network_audit сам разберёт формат */ }

    return { harBuffer, hostsCount, warnings };
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* temp */ }
  }
}

module.exports = { capture, status, validateUrl };
