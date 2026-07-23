"use strict";
// Адаптер итоговых PDF для Роспатента: Реферат.pdf + Фрагмент_кода.pdf
// (../../03_docs/pdf.js, pdfkit + Liberation Serif/Mono). Сохраняет их как артефакты
// с префиксами dep_referat_/dep_codefrag_ — те же, что у трекера, поэтому PDF
// закрывают пункты «Реферат» и «Фрагмент кода» и заменяют прежние .docx-версии.

const fs = require("fs");
const store = require("./store");
const pdf = require("../../03_docs/pdf");
const { LISTING_ARTIFACT } = require("./prepare");

function safeName(s) {
  return String(s || "product").replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, " ").trim();
}

// Заменяет прежние артефакты того же kind (и .docx, и .pdf) на новый файл.
function saveReplacing(id, kind, name, buffer) {
  for (const a of store.listArtifacts(id)) {
    const n = a.name.toLowerCase();
    if (n.startsWith(kind + "_") && n !== name.toLowerCase() && /\.(docx|pdf)$/i.test(n)) {
      try { fs.unlinkSync(store.artifactPath(id, a.name)); } catch (_) { /* уже нет */ }
    }
  }
  return store.saveArtifact(id, name, buffer);
}

// Генерирует оба PDF. Требует, чтобы листинг (LISTING_ARTIFACT) ещё существовал —
// поэтому вызывается до depon-фрагмента, который листинг удаляет.
async function generate(id) {
  const product = store.getProduct(id);
  const short = safeName(product.product && product.product.shortName);

  const lp = store.artifactPath(id, LISTING_ARTIFACT);
  const listing = fs.existsSync(lp) ? fs.readFileSync(lp, "utf8") : "";

  const referatBuf = await pdf.buildReferatPdf(product);
  const fragBuf = await pdf.buildCodeFragmentPdf(product, listing);

  const referatName = `dep_referat_Реферат_${short}.pdf`;
  const fragName = `dep_codefrag_Фрагмент_кода_${short}.pdf`;
  saveReplacing(id, "dep_referat", referatName, referatBuf);
  saveReplacing(id, "dep_codefrag", fragName, fragBuf);

  // Зафиксировать выводимые из листинга поля (язык программирования) в карточку,
  // затем убрать сырьё листинга — как это делает depon-adapter.
  try { require("./rospatent").autofill(id); } catch (_) { /* не критично */ }
  if (fs.existsSync(lp)) { try { fs.unlinkSync(lp); } catch (_) { /* temp */ } }

  return {
    documents: [
      { kind: "dep_referat", title: "Реферат программы", name: referatName, bytes: referatBuf.length },
      { kind: "dep_codefrag", title: "Фрагмент исходного кода", name: fragName, bytes: fragBuf.length },
    ],
  };
}

module.exports = { generate, status: pdf.status };
