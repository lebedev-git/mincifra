"use strict";
// Адаптер к ядру проверок (../../02_checks/checks.js).
// Проверки читают артефакты (SBOM/HAR) по относительным путям из product.tech.*
// относительно baseDir. Для платформы baseDir = каталог продукта в data-слое,
// а пути к артефактам подставляются в копию product перед запуском.

const path = require("path");
const store = require("./store");
const { runAllChecks, buildMarkdownReport } = require("../../02_checks/checks");

// Готовит product для проверок: подставляет фактические имена загруженных
// артефактов (SBOM/HAR) как относительные пути от каталога продукта.
function prepareProduct(id, product) {
  const p = JSON.parse(JSON.stringify(product || {}));
  p.tech = p.tech || {};
  const artifacts = store.listArtifacts(id).map((a) => a.name);

  const sbom = pickArtifact(artifacts, ["sbom", ".cdx", "cyclonedx", "bom"]);
  const har = pickArtifact(artifacts, [".har", "network"]);
  if (sbom) p.tech.sbomFile = path.join("artifacts", sbom);
  else delete p.tech.sbomFile; // нет файла → проверка вернёт SKIP, а не FAIL по чужому пути
  if (har) p.tech.networkEvidenceFile = path.join("artifacts", har);
  else delete p.tech.networkEvidenceFile;
  return p;
}

function pickArtifact(names, hints) {
  const lower = names.map((n) => ({ n, l: n.toLowerCase() }));
  for (const h of hints) {
    const hit = lower.find((x) => x.l.includes(h));
    if (hit) return hit.n;
  }
  return null;
}

// Запуск проверок для продукта id. Возвращает { results, totals, overall, markdown, ranAt }.
// opts.live — добавить живую HTTP-проверку страницы продукта (см. checks.js).
async function runForProduct(id, opts = {}) {
  const product = store.getProduct(id);
  const prepared = prepareProduct(id, product);
  const baseDir = store.productDir(id); // артефакты лежат здесь, пути относительны ему
  const payload = await runAllChecks(prepared, baseDir, opts);
  const markdown = buildMarkdownReport(payload, prepared, {
    productLabel: `${id}/product.json`,
  });
  const report = { ...payload, markdown, ranAt: new Date().toISOString() };
  store.saveReport(id, report);
  return report;
}

module.exports = { runForProduct, prepareProduct };
