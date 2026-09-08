"use strict";
// CLI-обёртка технических проверок готовности к реестру российского ПО.
// Запуск:  node 02_checks/run_checks.js [путь к product.json] [--live]
// По умолчанию берёт ../product.json, при отсутствии — ../product.example.json.
// --live — добавить живую HTTP-проверку productPageUrl (реальный запрос в сеть,
//          по умолчанию выключено — без флага инструмент офлайн).
// Итог: консольный отчёт + Markdown-отчёт 02_checks/last_report.md.
// Код возврата: 0 — нет FAIL; 1 — есть хотя бы один FAIL.
//
// Вся логика — в ./checks.js (переиспользуется веб-платформой).

const fs = require("fs");
const path = require("path");
const { runAllChecks, buildMarkdownReport, findingObject, overallHint, STATUS_ICON } = require("./checks");

const CHECKS_DIR = __dirname;
const PIPELINE_DIR = path.resolve(CHECKS_DIR, "..");

function resolveProductPath(arg) {
  if (arg) return path.resolve(process.cwd(), arg);
  const candidate = path.join(PIPELINE_DIR, "product.json");
  if (fs.existsSync(candidate)) return candidate;
  return path.join(PIPELINE_DIR, "product.example.json");
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--live");
  const live = process.argv.includes("--live");
  const productPath = resolveProductPath(args[0]);
  if (!fs.existsSync(productPath)) {
    console.error(`Не найден файл карточки продукта: ${productPath}`);
    process.exit(2);
  }
  let product;
  try {
    product = JSON.parse(fs.readFileSync(productPath, "utf8"));
  } catch (e) {
    console.error(`Ошибка разбора ${productPath}: ${e.message}`);
    process.exit(2);
  }

  // baseDir для относительных путей к артефактам (SBOM/HAR) — каталог pipeline.
  const payload = await runAllChecks(product, PIPELINE_DIR, { live });
  const { results, totals, overall } = payload;

  // --- Консоль ---
  const name = (product.product && product.product.name) || "(без имени)";
  console.log("");
  console.log("═══ Проверка готовности к реестру российского ПО ═══");
  console.log(`Продукт:  ${name}`);
  console.log(`Карточка: ${path.relative(process.cwd(), productPath) || productPath}`);
  console.log("");
  for (const r of results) {
    console.log(`${STATUS_ICON[r.status] || "?"}  [${r.status}] ${r.title}`);
    console.log(`     ${r.summary}`);
    for (const f of r.findings) {
      const detail = findingObject(f);
      console.log(`       • ${f.severity}: ${detail}${detail ? " — " : ""}${f.note || ""}${f.license ? " [" + f.license + "]" : ""}`);
    }
  }
  console.log("");
  console.log(`ИТОГ: ${STATUS_ICON[overall]} ${overall}  ` +
    `(PASS ${totals.PASS} · WARN ${totals.WARN} · FAIL ${totals.FAIL} · SKIP ${totals.SKIP})`);
  console.log(`→ ${overallHint(overall, totals)}`);
  console.log("");

  // --- Markdown-отчёт ---
  const md = buildMarkdownReport(payload, product, {
    productLabel: path.relative(PIPELINE_DIR, productPath) || productPath,
  });
  const out = path.join(CHECKS_DIR, "last_report.md");
  fs.writeFileSync(out, md, "utf8");
  console.log(`Отчёт сохранён: ${path.relative(process.cwd(), out) || out}`);

  process.exit(overall === "FAIL" ? 1 : 0);
}

main().catch((e) => { console.error("Ошибка выполнения проверок:", e.message || e); process.exit(2); });
