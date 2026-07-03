"use strict";
// Аудит лицензионной чистоты OSS по SBOM в формате CycloneDX (JSON).
// Сгенерировать SBOM: `syft <target> -o cyclonedx-json` или `cdxgen`.
// Классифицирует компоненты по категориям риска (см. lib/rules.js) и флагует
// блокеры strong copyleft (GPL/AGPL), «no-license» и критические лицензии.

const fs = require("fs");
const path = require("path");
const { LICENSE_RISK } = require("./rules");

// Индекс: SPDX-идентификатор (upper) -> уровень риска.
const SPDX_INDEX = (() => {
  const idx = new Map();
  for (const level of Object.keys(LICENSE_RISK)) {
    (LICENSE_RISK[level].spdx || []).forEach((id) => idx.set(id.toUpperCase(), level));
  }
  return idx;
})();

const CRITICAL_MARKERS = (LICENSE_RISK.critical.markers || []).map((m) => m.toUpperCase());

// Достаёт список строковых лицензий из компонента CycloneDX.
function licensesOf(component) {
  const out = [];
  const arr = component.licenses || [];
  for (const l of arr) {
    if (l.license && (l.license.id || l.license.name)) out.push(l.license.id || l.license.name);
    else if (l.expression) out.push(l.expression);
  }
  if (!out.length && component.copyright) out.push("NOASSERTION");
  return out.length ? out : ["NOASSERTION"];
}

// Числовой ранг риска (чем больше, тем строже). unknown = 2.5: при выборе строгой
// ветки (AND) хуже medium, но не блокирует как high — «неизвестность», а не блокер.
const RISK_RANK = { low: 1, medium: 2, unknown: 2.5, high: 3, critical: 4 };
const RANK_LEVEL = { 1: "low", 2: "medium", 2.5: "unknown", 3: "high", 4: "critical" };

// Уровень одиночного лицензионного идентификатора/маркера (без операторов).
function atomLevel(id) {
  const up = String(id).toUpperCase().trim();
  if (SPDX_INDEX.has(up)) return SPDX_INDEX.get(up);
  if (CRITICAL_MARKERS.some((m) => up.includes(m)) || up === "") return "critical"; // no-license
  return "unknown";
}

// Разбор SPDX-выражения по семантике операторов (спецификация SPDX):
//   OR   → лицензиат ВЫБИРАЕТ одну лицензию → берём НАИМЕНЕЕ строгую (min ранга);
//   AND  → нужно соблюсти ВСЕ              → берём НАИБОЛЕЕ строгую (max ранга);
//   WITH → лицензия + исключение          → ранг самой лицензии (исключение смягчает).
// Приоритет: WITH > AND > OR. Пример: "(MIT OR GPL-3.0-or-later)" → MIT (можно выбрать).
function tokenizeSpdx(up) {
  return up.match(/\(|\)|[A-Z0-9.\-+]+/g) || []; // ID сохраняются целиком (дефисы внутри)
}
function evalSpdx(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function parseOr() {
    let r = parseAnd();
    while (peek() === "OR") { next(); r = Math.min(r, parseAnd()); }
    return r;
  }
  function parseAnd() {
    let r = parseWith();
    while (peek() === "AND") { next(); r = Math.max(r, parseWith()); }
    return r;
  }
  function parseWith() {
    const r = parseAtom();
    while (peek() === "WITH") { next(); parseAtom(); } // исключение не ужесточает лицензию
    return r;
  }
  function parseAtom() {
    if (peek() === "(") { next(); const r = parseOr(); if (peek() === ")") next(); return r; }
    return RISK_RANK[atomLevel(next())];
  }
  const rank = parseOr();
  if (pos < tokens.length) throw new Error("unparsed SPDX tail"); // не чистое выражение
  return rank;
}

function classify(licenseStr) {
  const up = String(licenseStr).toUpperCase().trim();
  if (SPDX_INDEX.has(up)) return SPDX_INDEX.get(up);        // быстрый путь: одиночный ID
  if (!/(^|[\s)])(OR|AND|WITH)([\s(]|$)/.test(up) && !up.includes("("))
    return atomLevel(up);                                    // нет операторов → одиночный токен/маркер
  try {
    return RANK_LEVEL[evalSpdx(tokenizeSpdx(up))] || "unknown";
  } catch (_) {
    return atomLevel(up);                                    // невалидное выражение — как одиночный
  }
}

function run(product, baseDir) {
  const id = "license_scan";
  const title = "Лицензионная чистота OSS (нет GPL/AGPL в ядре, нет no-license)";
  const rel = product && product.tech && product.tech.sbomFile;

  if (!rel) {
    return { id, title, status: "SKIP",
      summary: "Не указан tech.sbomFile — сгенерируйте SBOM (CycloneDX JSON).", findings: [] };
  }
  const file = path.resolve(baseDir, rel);
  if (!fs.existsSync(file)) {
    return { id, title, status: "SKIP", summary: `Файл не найден: ${rel}`, findings: [] };
  }

  let sbom;
  try {
    sbom = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { id, title, status: "FAIL", summary: `Не удалось разобрать SBOM ${rel}: ${e.message}`, findings: [] };
  }
  const components = Array.isArray(sbom.components) ? sbom.components : [];
  if (!components.length) {
    return { id, title, status: "WARN",
      summary: "В SBOM нет компонентов (components[]). Проверьте формат CycloneDX.", findings: [] };
  }

  const findings = [];
  const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const c of components) {
    const name = `${c.name || "?"}@${c.version || "?"}`;
    for (const lic of licensesOf(c)) {
      const level = classify(lic);
      counts[level] = (counts[level] || 0) + 1;
      if (level === "high" || level === "critical") {
        findings.push({ severity: "FAIL", component: name, license: lic,
          note: LICENSE_RISK[level] ? LICENSE_RISK[level].action : "блокер" });
      } else if (level === "unknown") {
        findings.push({ severity: "WARN", component: name, license: lic,
          note: "лицензия не распознана — классифицировать вручную" });
      } else if (level === "medium") {
        findings.push({ severity: "WARN", component: name, license: lic,
          note: LICENSE_RISK.medium.action });
      }
    }
  }

  const hasFail = counts.critical > 0 || counts.high > 0;
  const hasWarn = counts.medium > 0 || counts.unknown > 0;
  const status = hasFail ? "FAIL" : hasWarn ? "WARN" : "PASS";
  const summary =
    `Компонентов: ${components.length}. ` +
    `Критич.: ${counts.critical}, strong copyleft: ${counts.high}, ` +
    `weak copyleft: ${counts.medium}, permissive: ${counts.low}, нераспознано: ${counts.unknown}.`;

  return { id, title, status, summary, findings };
}

module.exports = { run };
