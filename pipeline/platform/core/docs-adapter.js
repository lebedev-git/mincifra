"use strict";
// Адаптер к ядру генерации досье (../../03_docs/dossier.js).
// Складывает .docx в каталог продукта (<data>/products/<id>/dossier).

const store = require("./store");
const { buildDossier } = require("../../03_docs/dossier");

async function generateForProduct(id) {
  const product = store.getProduct(id);
  const outDir = store.dossierDir(id);
  const docs = await buildDossier(product, outDir);
  return { docs, generatedAt: new Date().toISOString() };
}

module.exports = { generateForProduct };
