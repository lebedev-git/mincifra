"use strict";
// Чистая логика технических проверок готовности (без побочных эффектов).
// Используется CLI-обёрткой run_checks.js и веб-платформой (platform/).
//
// runAllChecks(product, baseDir) -> { results, totals, overall }
//   product  — разобранный объект карточки продукта (product.json)
//   baseDir  — каталог для относительных путей к артефактам (SBOM/HAR)
// buildMarkdownReport(payload, product, { productLabel }) -> string

const path = require("path");

const foreignPayments = require("./lib/foreign_payments");
const licenseScan = require("./lib/license_scan");
const networkAudit = require("./lib/network_audit");
const pageCheck = require("./lib/page_check");
const requisites = require("./lib/requisites");

const STATUS_ICON = { PASS: "✅", WARN: "🟡", FAIL: "⛔", SKIP: "⚪" };

// Порядок проверок фиксирован для стабильного отчёта.
function runAllChecks(product, baseDir) {
  const results = [
    foreignPayments.run(product),
    licenseScan.run(product, baseDir),
    networkAudit.run(product, baseDir),
    pageCheck.run(product),
    requisites.run(product),
  ];
  const totals = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  results.forEach((r) => { totals[r.status] = (totals[r.status] || 0) + 1; });
  const overall = totals.FAIL > 0 ? "FAIL" : totals.WARN > 0 ? "WARN" : "PASS";
  return { results, totals, overall };
}

// Короткая деталь строки finding (используется и в консоли, и в отчёте, и в UI).
function findingObject(f) {
  return f.host || f.component || f.metric || f.field || "";
}

function overallHint(overall) {
  return overall === "FAIL"
    ? "Есть блокеры. На портал не подавать до устранения FAIL."
    : overall === "WARN"
    ? "Блокеров нет, но есть замечания (WARN/SKIP) — закрыть перед подачей."
    : "Технических блокеров не выявлено. Сверьте оставшиеся ручные пункты G2/G3.";
}

function buildMarkdownReport({ results, totals, overall }, product, opts = {}) {
  const name = (product.product && product.product.name) || "(без имени)";
  const label = opts.productLabel || "";
  const lines = [];
  lines.push(`# Отчёт технической готовности — ${name}`);
  lines.push("");
  if (label) lines.push(`- Карточка: \`${label}\``);
  lines.push(`- Итог: **${overall}** (PASS ${totals.PASS} · WARN ${totals.WARN} · FAIL ${totals.FAIL} · SKIP ${totals.SKIP})`);
  lines.push("");
  lines.push("> Отчёт сгенерирован автоматически. Дату проставьте при фиксации в трекере (G3).");
  lines.push("");
  for (const r of results) {
    lines.push(`## ${STATUS_ICON[r.status]} [${r.status}] ${r.title}`);
    lines.push("");
    lines.push(r.summary);
    if (r.findings.length) {
      lines.push("");
      lines.push("| Уровень | Объект | Замечание |");
      lines.push("| --- | --- | --- |");
      for (const f of r.findings) {
        const note = [f.note, f.license ? `лицензия: ${f.license}` : ""].filter(Boolean).join("; ");
        lines.push(`| ${f.severity} | ${findingObject(f)} | ${note} |`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

module.exports = {
  runAllChecks, buildMarkdownReport, findingObject, overallHint,
  STATUS_ICON,
};
