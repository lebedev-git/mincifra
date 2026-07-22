"use strict";
// CLI черновика карточки продукта из ЛОКАЛЬНОЙ папки проекта.
// Обёртка над platform/core/autofill.js (тот отдаёт patch; здесь накладываем его на
// шаблон product.example.json и получаем готовый к правке product.json-черновик).
//
// Запуск:
//   node 00_card/autofill_card.js <путь-к-проекту> [--notes "своё описание"] [--out <файл>]
//
// ВАЖНО: это ЧЕРНОВИК. Реквизиты/финансы/класс НЕ выдумываются — их проверяет и
// вводит человек. Значения-примеры из шаблона помечены как требующие сверки.
//
// Код возврата: 0 — черновик создан; 2 — нет пути.

const fs = require("fs");
const path = require("path");
const autofill = require("../platform/core/autofill");
const readiness = require("../platform/core/readiness");

const PIPELINE_DIR = path.resolve(__dirname, "..");
const TEMPLATE = path.join(PIPELINE_DIR, "product.example.json");

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && base && typeof base[k] === "object") {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Обнуляет поля-примеры из шаблона, которые НЕЛЬЗЯ выдумывать за человека
// (реквизиты, финансы, класс, юр. номера) и текстовые поля, которые autofill не заполнил.
// Цель — честная картина полноты: readiness должен показать реальные пробелы, а не
// демо-значения шаблона. deliveryType/guiLanguage оставляем как разумные дефолты.
function scrubUnfilled(m, applied) {
  const has = (f) => applied.includes(f);
  if (m.rightholder) {
    m.rightholder.orgName = "";
    m.rightholder.inn = "";
    m.rightholder.ogrn = "";
    m.rightholder.address = "";
    m.rightholder.ruControlSharePercent = null;
    if (m.rightholder.signatory) { m.rightholder.signatory.name = ""; m.rightholder.signatory.position = ""; m.rightholder.signatory.hasUKEP = false; }
  }
  if (m.finance) { m.finance.annualRevenueProduct = null; m.finance.annualForeignPayments = null; }
  if (m.product) {
    m.product.class = [];
    if (!has("description")) m.product.description = "";
    if (!has("purpose")) m.product.purpose = "";
    if (!has("productPageUrl")) m.product.productPageUrl = "";
    m.product.name = m.product.shortName || ""; // стартовое имя = shortName (человек уточнит)
  }
  if (m.rights) { m.rights.rospatentCertificateNumber = ""; m.rights.rospatentCertificateDate = ""; }
  return m;
}

async function main() {
  const args = process.argv.slice(2);
  const notesIdx = args.indexOf("--notes");
  const notes = notesIdx >= 0 ? args[notesIdx + 1] : "";
  const outIdx = args.indexOf("--out");
  const outArg = outIdx >= 0 ? args[outIdx + 1] : null;
  const dirArg = args.find((a) => !a.startsWith("--") && a !== notes && a !== outArg);

  if (!dirArg) {
    console.error('Укажите путь к проекту:  node 00_card/autofill_card.js <путь> [--notes "…"] [--out <файл>]');
    process.exit(2);
  }
  const srcDir = path.resolve(process.cwd(), dirArg);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    console.error(`Каталог не найден: ${srcDir}`);
    process.exit(2);
  }
  if (!fs.existsSync(TEMPLATE)) {
    console.error(`Не найден шаблон карточки: ${TEMPLATE}`);
    process.exit(2);
  }

  console.log("");
  console.log("═══ Черновик карточки продукта (автозаполнение из кода) ═══");
  console.log(`Проект: ${srcDir}`);
  console.log("");

  const template = JSON.parse(fs.readFileSync(TEMPLATE, "utf8"));
  delete template.$schema_note;

  const draft = await autofill.buildDraft({ srcDir, notes });
  const merged = scrubUnfilled(deepMerge(template, draft.patch), draft.applied);

  const outFile = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.join(srcDir, "reestr-artifacts", "product.draft.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(merged, null, 2) + "\n", "utf8");

  console.log(`Черновик сохранён: ${outFile}`);
  console.log("");
  if (draft.applied.length) {
    console.log("Заполнено из кода (проверьте): " + draft.applied.join(", "));
  }
  console.log(`LLM-обогащение: ${draft.llm.enabled ? (draft.llm.used ? "применено" : "включено, но не сработало") : "выключено (офлайн)"}`);
  if (draft.warnings.length) {
    console.log("");
    console.log("Замечания автозаполнения:");
    for (const w of draft.warnings) console.log(`  ⚠ ${w}`);
  }

  // Что осталось заполнить человеку (по обязательным полям карточки).
  const rd = readiness.cardCompleteness(merged);
  console.log("");
  console.log(`Полнота карточки: ${rd.filled}/${rd.total} (${rd.percent}%).`);
  if (rd.missing.length) {
    console.log("Осталось заполнить вручную (реквизиты/финансы/класс — не выдумываются):");
    for (const m of rd.missing) console.log(`  • [${m.section}] ${m.label}  (${m.path})`);
  }
  console.log("");
  console.log("Дальше: впишите реальные данные правообладателя и артефакты, затем прогоните:");
  console.log(`  node 02_checks/run_checks.js "${path.relative(process.cwd(), outFile) || outFile}"`);
  console.log("");
  process.exit(0);
}

main().catch((e) => { console.error("Ошибка автозаполнения:", e.message || e); process.exit(1); });
