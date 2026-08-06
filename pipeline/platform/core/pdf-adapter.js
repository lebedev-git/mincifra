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

  // Реферат берём из core/rospatent (п. 30 Правил, ≤ 900 знаков) — единый текст
  // для формы и для PDF. Титульный лист (п. 29) — правообладатель и авторы из профиля.
  const rospatent = require("./rospatent");
  const referatText = rospatent.buildReferat(product, rospatent.snapshotBytes(id));
  const authors = rospatent.resolveAuthors(product);
  // Схема B: правообладатель — первый автор (депонирование оформляется на физлицо).
  const titleInfo = {
    rightholder: (authors[0] && authors[0].fullName)
      || (store.getProfile().rightholder || {}).orgName || "",
    authors: authors.map((a) => a.fullName).filter(Boolean),
  };

  const referat = await pdf.buildReferatPdf(product, referatText);
  const referatName = `dep_referat_Реферат_${short}.pdf`;
  saveReplacing(id, "dep_referat", referatName, referat.buffer);

  // Листинг существует только сразу после подготовки (ниже он удаляется). Если его
  // нет, а готовый фрагмент кода уже лежит в артефактах — оставляем прежний файл:
  // иначе повторный вызов затёр бы полноценный PDF заглушкой «листинг не найден».
  const existingFrag = store.listArtifacts(id).find((a) => /^dep_codefrag_.*\.pdf$/i.test(a.name));
  const documents = [
    { kind: "dep_referat", title: "Реферат программы", name: referatName,
      bytes: referat.buffer.length, pages: referat.pages, copies: 2 },
  ];
  if (!listing.trim() && existingFrag) {
    documents.push({ kind: "dep_codefrag", title: "Фрагмент исходного кода",
      name: existingFrag.name, bytes: existingFrag.size, copies: 1, reused: true });
  } else {
    const frag = await pdf.buildCodeFragmentPdf(product, listing, titleInfo);
    const fragName = `dep_codefrag_Фрагмент_кода_${short}.pdf`;
    saveReplacing(id, "dep_codefrag", fragName, frag.buffer);
    documents.push({ kind: "dep_codefrag", title: "Фрагмент исходного кода", name: fragName,
      bytes: frag.buffer.length, pages: frag.pages, copies: 1 });
  }

  // Зафиксировать выводимые из листинга поля (язык программирования) в карточку,
  // затем убрать сырьё листинга — как это делает depon-adapter.
  try { require("./rospatent").autofill(id); } catch (_) { /* не критично */ }
  if (fs.existsSync(lp)) { try { fs.unlinkSync(lp); } catch (_) { /* temp */ } }

  // pages — для графы 9 заявления («на ___ л.»). Реферат подаётся в 2 экземплярах.
  return { documents };
}

module.exports = { generate, status: pdf.status };
