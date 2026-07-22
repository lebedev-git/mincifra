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
const { LISTING_ARTIFACT } = require("./prepare");

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

// Читает собранный листинг исходников (сырьё авто-подготовки) для «Фрагмента кода».
function listingContext(id) {
  const p = store.artifactPath(id, LISTING_ARTIFACT);
  if (!fs.existsSync(p)) return {};
  return { listing: fs.readFileSync(p, "utf8") };
}

async function generate(id, kind) {
  const product = store.getProduct(id);
  const def = listDeponDocs().find((d) => d.kind === kind);
  if (!def) { const e = new Error("Неизвестный документ депонирования"); e.status = 400; throw e; }

  let ctx = {};
  if (def.needsArchive) {
    ctx = snapshotContext(id);
    if (!ctx.hash) {
      const e = new Error("Сначала загрузите архив снимка кода — по нему считается контрольная сумма.");
      e.status = 400; throw e;
    }
  } else if (def.needsListing) {
    ctx = listingContext(id);
    if (!ctx.listing) {
      const e = new Error("Сначала выполните «Подготовить автоматически» — платформа соберёт листинг исходного кода.");
      e.status = 400; throw e;
    }
  }

  // Автор-физлицо из профиля — правообладатель/заявитель во всех документах (Схема B).
  ctx.author = (store.getProfile() || {}).author || {};

  const { fileName, buffer, title } = await buildDeponDoc(kind, product, ctx);
  // Имя артефакта: kind_<файл>.docx — префикс группирует по пункту трекера.
  const artifactName = fileName.toLowerCase().startsWith(kind + "_") ? fileName : `${kind}_${fileName}`;
  // Повторная генерация заменяет прежний документ, а не копит дубли: имя файла
  // содержит название продукта и при его смене меняется. Архивы (.zip) не трогаем.
  for (const a of store.listArtifacts(id)) {
    if (a.name.toLowerCase().startsWith(kind + "_") && /\.docx$/i.test(a.name) && a.name !== artifactName) {
      fs.unlinkSync(store.artifactPath(id, a.name));
    }
  }
  const rel = store.saveArtifact(id, artifactName, buffer);

  // Сырьё листинга больше не нужно после успешной генерации фрагмента — удаляем,
  // чтобы не путать пользователя тяжёлым служебным файлом в папке артефактов.
  // Повторная генерация фрагмента потребует заново прогнать мастер подготовки.
  if (def.needsListing) {
    // Перед удалением фиксируем выводимые из листинга поля (язык программирования
    // и пр.) в карточку — иначе автоопределению будет не из чего считать.
    try { require("./rospatent").autofill(id); } catch (_) { /* не критично */ }
    const lp = store.artifactPath(id, LISTING_ARTIFACT);
    if (fs.existsSync(lp)) fs.unlinkSync(lp);
  }

  return { saved: rel, name: artifactName, title, bytes: buffer.length };
}

// Список того, что можно сгенерировать (для UI).
function generatable() {
  return listDeponDocs().map((d) => ({ kind: d.kind, title: d.title, needsArchive: !!d.needsArchive }));
}

module.exports = { generate, generatable };
