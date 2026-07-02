"use strict";
// Адаптер генерации документов депонирования (../../03_docs/depon.js).
// Собирает .docx из карточки и сохраняет как артефакт с префиксом kind_ —
// сгенерированный файл сразу закрывает соответствующий пункт трекера подготовки.
// Для «Акта фиксации версии» подставляет SHA-256 ранее загруженного архива снимка.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("./store");
const { listDeponDocs, buildDeponDoc } = require("../../03_docs/depon");

// Ищет загруженный архив снимка кода (dep_snapshot_*, не .docx) и считает его хеш.
function snapshotContext(id) {
  const arts = store.listArtifacts(id)
    .filter((a) => /^dep_snapshot_/i.test(a.name) && !/\.docx$/i.test(a.name));
  if (!arts.length) return {};
  const art = arts[0];
  const buf = fs.readFileSync(store.artifactPath(id, art.name));
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  return {
    archiveName: art.name.replace(/^dep_snapshot_/i, ""),
    sizeBytes: buf.length,
    hash,
    stampedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
  };
}

async function generate(id, kind) {
  const product = store.getProduct(id);
  const def = listDeponDocs().find((d) => d.kind === kind);
  if (!def) { const e = new Error("Неизвестный документ депонирования"); e.status = 400; throw e; }

  const ctx = def.needsArchive ? snapshotContext(id) : {};
  if (def.needsArchive && !ctx.hash) {
    const e = new Error("Сначала загрузите архив снимка кода — по нему считается контрольная сумма.");
    e.status = 400; throw e;
  }

  const { fileName, buffer, title } = await buildDeponDoc(kind, product, ctx);
  // Имя артефакта: kind_<файл>.docx — префикс группирует по пункту трекера.
  const artifactName = fileName.toLowerCase().startsWith(kind + "_") ? fileName : `${kind}_${fileName}`;
  const rel = store.saveArtifact(id, artifactName, buffer);
  return { saved: rel, name: artifactName, title, bytes: buffer.length };
}

// Список того, что можно сгенерировать (для UI).
function generatable() {
  return listDeponDocs().map((d) => ({ kind: d.kind, title: d.title, needsArchive: !!d.needsArchive }));
}

module.exports = { generate, generatable };
