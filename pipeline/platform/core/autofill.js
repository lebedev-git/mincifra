"use strict";
// Автозаполнение карточки продукта из локального источника кода + заметок пользователя.
// Возвращает ЧЕРНОВИК (patch) полей карточки — не сохраняет молча. Решение и правку
// оставляем человеку (как автозаполнение по ИНН из DaData): значения помечены как
// предположения. Реквизиты/финансы не выдумываются — они из профиля или вводятся вручную.
//
// Источник фактов — детерминированный разбор package.json / README / файлов проекта.
// LLM (core/llm.js) — опциональное обогащение текстовых полей; при выключенном ключе
// используется свободный текст пользователя как есть (полный офлайн).

const fs = require("fs");
const path = require("path");
const llm = require("./llm");

// Сопоставление npm-зависимостей → СУБД и стоп-факторы (для tech.databases и подсказок).
const DB_HINTS = [
  [/(^|[/@])pg$|node-postgres|postgres|typeorm|prisma|sequelize/i, "PostgreSQL"],
  [/better-sqlite3|sqlite3|sqlite/i, "SQLite"],
  [/mysql2?|mariadb/i, "MySQL/MariaDB"],
  [/mongodb|mongoose/i, "MongoDB"],
  [/redis|ioredis/i, "Redis"],
  [/oracledb/i, "Oracle (стоп-фактор!)"],
  [/mssql|tedious/i, "MS SQL Server (стоп-фактор!)"],
];
// Определение основного стека по зависимостям (для описания/назначения).
const STACK_HINTS = [
  [/(^|[/@])next$/i, "Next.js"],
  [/(^|[/@])react$/i, "React"],
  [/(^|[/@])vue$/i, "Vue"],
  [/(^|[/@])@angular\//i, "Angular"],
  [/express|fastify|koa|nestjs/i, "Node-бэкенд"],
  [/electron/i, "Electron (десктоп)"],
];

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return null; }
}
function firstExisting(dir, names) {
  for (const n of names) { const f = path.join(dir, n); if (fs.existsSync(f)) return f; }
  return null;
}

// Извлекает «сырые факты» о проекте из каталога исходников (детерминированно, без сети).
function extractFacts(srcDir) {
  const facts = { deps: [], databases: [], stack: [], hasReadme: false, files: {} };
  if (!srcDir || !fs.existsSync(srcDir)) return facts;

  const pkg = readJsonSafe(path.join(srcDir, "package.json"));
  if (pkg) {
    facts.name = pkg.name || "";
    facts.version = pkg.version || "";
    facts.description = pkg.description || "";
    facts.homepage = pkg.homepage || "";
    facts.license = typeof pkg.license === "string" ? pkg.license : (pkg.license && pkg.license.type) || "";
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    facts.deps = Object.keys(deps);
    facts.files.packageJson = true;
  }

  // СУБД и стек — по зависимостям.
  for (const dep of facts.deps) {
    for (const [rx, label] of DB_HINTS) if (rx.test(dep) && !facts.databases.includes(label)) facts.databases.push(label);
    for (const [rx, label] of STACK_HINTS) if (rx.test(dep) && !facts.stack.includes(label)) facts.stack.push(label);
  }

  // README — первый содержательный абзац как черновик описания.
  const readme = firstExisting(srcDir, ["README.md", "README.MD", "Readme.md", "README", "readme.md"]);
  if (readme) {
    facts.hasReadme = true;
    try {
      const raw = fs.readFileSync(readme, "utf8");
      facts.readmeExcerpt = firstMeaningfulParagraph(raw);
    } catch (_) { /* нечитаемо */ }
  }

  // Признаки инфраструктуры (для подсказок по требованиям реестра).
  facts.files.dockerfile = fs.existsSync(path.join(srcDir, "Dockerfile"));
  facts.files.hasGithubCI = fs.existsSync(path.join(srcDir, ".github", "workflows"));
  return facts;
}

// Первый абзац README, пропуская бейджи/заголовки/шаблонные строки create-next-app.
function firstMeaningfulParagraph(md) {
  const lines = String(md || "").split(/\r?\n/);
  const buf = [];
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) { if (buf.length) break; else continue; }
    if (/^#/.test(t)) continue;                        // заголовки
    if (/^!\[|^\[!\[|badge|shields\.io/i.test(t)) continue; // бейджи
    if (/bootstrapped with|create-next-app|getting started|run the development server|npm run dev|yarn dev|pnpm dev/i.test(t)) continue; // шаблон CRA/Next
    if (/^```/.test(t)) break;
    buf.push(t);
    if (buf.join(" ").length > 400) break;
  }
  return buf.join(" ").slice(0, 600);
}

// Строит патч карточки из фактов + заметок. Числовые/юридические поля не трогаем.
// missing — что осталось на человека. Все значения — предположения (draft).
async function buildDraft({ srcDir, notes }) {
  const facts = extractFacts(srcDir);
  const patch = { product: {} };
  const p = patch.product;
  const applied = [];
  const notesTxt = String(notes || "").trim();

  if (facts.name) { p.shortName = facts.name; applied.push("shortName"); }
  if (facts.version) { p.version = facts.version; applied.push("version"); }
  if (facts.homepage) { p.productPageUrl = facts.homepage; applied.push("productPageUrl"); }

  // Описание: приоритет — заметки пользователя, затем package.description, затем README.
  const baseDesc = notesTxt || facts.description || facts.readmeExcerpt || "";
  if (baseDesc) { p.description = baseDesc; applied.push("description"); }

  // tech.databases — из зависимостей (черновик, человек сверяет).
  const chosen = facts.databases.filter((d) => !/стоп-фактор/i.test(d));
  const stops = facts.databases.filter((d) => /стоп-фактор/i.test(d));
  if (chosen.length) { patch.tech = { databases: chosen }; applied.push("tech.databases"); }

  // Опциональное LLM-обогащение текстовых полей.
  let llmUsed = false, llmError = null;
  if (llm.isEnabled()) {
    try {
      const draft = await llm.draftCardText({ facts: compactFacts(facts), notes: notesTxt });
      if (draft.description) { p.description = draft.description; if (!applied.includes("description")) applied.push("description"); }
      if (draft.purpose) { p.purpose = draft.purpose; applied.push("purpose"); }
      if (draft.guiLanguage) { p.guiLanguage = draft.guiLanguage; applied.push("guiLanguage"); }
      if (draft.classHint) patch._classHint = draft.classHint;
      llmUsed = true;
    } catch (e) {
      llmError = e.message || String(e); // не роняем автозаполнение — детерминированный черновик остаётся
    }
  }

  const warnings = [];
  if (stops.length) warnings.push("Обнаружены санкционные СУБД в зависимостях: " + stops.join(", ") + " — это стоп-фактор реестра.");
  if (facts.license && /^(gpl|agpl)/i.test(facts.license)) warnings.push(`Лицензия проекта «${facts.license}» может быть стоп-фактором (GPL/AGPL в ядре).`);
  if (!facts.files.packageJson) warnings.push("package.json не найден — часть полей (имя/версия/зависимости) не заполнена.");
  if (llmError) warnings.push("LLM-улучшение не сработало (" + llmError + ") — использован простой черновик.");

  return {
    patch,
    applied,
    facts: compactFacts(facts),
    llm: { enabled: llm.isEnabled(), used: llmUsed },
    warnings,
  };
}

// Урезанные факты для передачи в LLM и в UI (без гигантских списков).
function compactFacts(f) {
  return {
    name: f.name || "", version: f.version || "", description: f.description || "",
    homepage: f.homepage || "", license: f.license || "",
    stack: f.stack || [], databases: f.databases || [],
    readmeExcerpt: f.readmeExcerpt || "",
    depsCount: (f.deps || []).length,
    dockerfile: !!(f.files && f.files.dockerfile),
    githubCI: !!(f.files && f.files.hasGithubCI),
  };
}

module.exports = { buildDraft, extractFacts, compactFacts };
