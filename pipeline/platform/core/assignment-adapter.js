"use strict";
// Адаптер генерации документов отчуждения права (../../03_docs/assignment.js).
// Собирает .docx (договор отчуждения + акт) из карточки и профиля, сохраняет как
// артефакт с префиксом kind_. Требует полученного свидетельства ПрЭВМ (№ + дата):
// без него право у автора не подтверждено и договор отчуждать нечего.

const store = require("./store");
const rights = require("./rights");
const { listAssignmentDocs, buildAssignmentDoc } = require("../../03_docs/assignment");

function generate(id, kind) {
  const product = store.getProduct(id);
  const def = listAssignmentDocs().find((d) => d.kind === kind);
  if (!def) { const e = new Error("Неизвестный документ отчуждения"); e.status = 400; throw e; }

  // Гейт: отчуждение возможно только после получения свидетельства (dep_granted+).
  if (!rights.canAssign(product)) {
    const e = new Error("Сначала внесите № и дату свидетельства Роспатента — без них право автора не подтверждено.");
    e.status = 400; throw e;
  }

  // Автор-физлицо — из единого профиля (Схема B).
  const author = (store.getProfile() || {}).author || {};
  if (!author.fullName) {
    const e = new Error("Заполните блок «Автор (физлицо)» в профиле — он подставляется в договор отчуждения.");
    e.status = 400; throw e;
  }

  return buildAssignmentDoc(kind, product, { author }).then(({ fileName, buffer, title }) => {
    const artifactName = fileName.toLowerCase().startsWith(kind + "_") ? fileName : `${kind}_${fileName}`;
    const rel = store.saveArtifact(id, artifactName, buffer);
    return { saved: rel, name: artifactName, title, bytes: buffer.length };
  });
}

// Список документов отчуждения (для UI).
function generatable() {
  return listAssignmentDocs().map((d) => ({ kind: d.kind, title: d.title }));
}

module.exports = { generate, generatable };
