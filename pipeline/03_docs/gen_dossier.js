"use strict";
// CLI-обёртка генерации пакета досье для подачи в реестр российского ПО.
// Запуск:  node 03_docs/gen_dossier.js [путь к product.json]
// Формирует .docx-документы в 03_docs/out/ на основе карточки продукта.
//
// Вся логика — в ./dossier.js (переиспользуется веб-платформой).

const fs = require("fs");
const path = require("path");
const { buildDossier } = require("./dossier");

const PIPELINE_DIR = path.resolve(__dirname, "..");
const OUT_DIR = path.join(__dirname, "out");

function loadProduct(arg) {
  const p = arg
    ? path.resolve(process.cwd(), arg)
    : fs.existsSync(path.join(PIPELINE_DIR, "product.json"))
    ? path.join(PIPELINE_DIR, "product.json")
    : path.join(PIPELINE_DIR, "product.example.json");
  if (!fs.existsSync(p)) { console.error(`Не найдена карточка продукта: ${p}`); process.exit(2); }
  return { product: JSON.parse(fs.readFileSync(p, "utf8")), source: p };
}

async function main() {
  const { product, source } = loadProduct(process.argv[2]);
  console.log(`\nГенерация досье из: ${path.relative(process.cwd(), source) || source}\n`);
  await buildDossier(product, OUT_DIR, (info) => {
    console.log(`  ✅ ${info.name}  (${info.bytes} байт)`);
  });
  console.log(`\nГотово. Каталог: ${path.relative(process.cwd(), OUT_DIR) || OUT_DIR}`);
  console.log("Проверьте документы юристом/бухгалтером перед подачей.\n");
}

main().catch((e) => { console.error("Ошибка генерации:", e); process.exit(1); });
