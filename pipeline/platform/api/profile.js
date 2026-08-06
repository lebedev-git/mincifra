"use strict";
// API единого профиля правообладателя. Данные организации и контакты техподдержки
// заполняются один раз и подставляются в новые карточки продуктов (см. api/products.js).
// Хранение — core/store.js (profile.json). Наружу — только «белый» список полей,
// чтобы в профиль не попадали произвольные ключи из тела запроса.

const store = require("../core/store");
const { readJsonBody, sendJson } = require("../core/http-util");

// Плоская схема профиля: путь в объекте профиля → допустимый тип значения.
// number приводится к числу/null, остальное — к строке. Ничего сверх этого не сохраняем.
const FIELDS = [
  ["rightholder.orgName", "string"],
  ["rightholder.inn", "string"],
  ["rightholder.ogrn", "string"],
  ["rightholder.address", "string"],
  ["rightholder.ruControlSharePercent", "number"],
  ["rightholder.signatory.name", "string"],
  ["rightholder.signatory.position", "string"],
  // Автор-физлицо (Схема B): на него оформляется депонирование ПрЭВМ в Роспатенте,
  // затем исключительное право отчуждается правообладателю (rightholder = ООО).
  // Единый автор на всю установку — заполняется один раз.
  // Авторы — отдельный список (см. AUTHOR_FIELDS ниже), а не плоские поля.
  ["support.contactFio", "string"],
  ["support.contactEmail", "string"],
  ["support.contactPhone", "string"],
];

// Поля одного автора. Графа 2 заявления (п. 13 Правил, приказ № 211): для
// российского физлица обязательны ИНН и серия/номер документа, удостоверяющего
// личность; СНИЛС — «при наличии». Графа 7А (п. 20): дата рождения, гражданство,
// место жительства, творческий вклад и способ упоминания при публикации.
const AUTHOR_FIELDS = [
  "fullName", "birthDate", "citizenship", "inn", "passport",
  "snils", "address", "contribution", "mentionMode",
];

// Список авторов из тела запроса: только известные поля, только записи с ФИО.
function sanitizeAuthors(src) {
  const raw = Array.isArray(src.authors) ? src.authors
    : (src.author ? [src.author] : null); // совместимость с прежним одиночным author
  if (!raw) return null;
  return raw
    .map((a) => {
      const out = {};
      for (const k of AUTHOR_FIELDS) out[k] = a && a[k] != null ? String(a[k]) : "";
      return out;
    })
    .filter((a) => a.fullName.trim());
}

function getVal(obj, pathStr) {
  return pathStr.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setVal(obj, pathStr, val) {
  const keys = pathStr.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { o[keys[i]] = o[keys[i]] || {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = val;
}

// Собирает профиль строго по FIELDS из присланного тела — защита от «мусорных» ключей.
function sanitize(body) {
  const src = (body && body.profile) || body || {};
  const out = {};
  for (const [pathStr, type] of FIELDS) {
    let v = getVal(src, pathStr);
    if (v === undefined) continue;
    if (type === "number") v = (v === "" || v === null) ? null : Number(v);
    else v = v == null ? "" : String(v);
    setVal(out, pathStr, v);
  }
  const authors = sanitizeAuthors(src);
  if (authors) out.authors = authors;
  return out;
}

function register(router) {
  router.get("/api/profile", (req, res) => {
    sendJson(res, 200, { profile: store.getProfile() });
  });

  router.put("/api/profile", async (req, res) => {
    const body = await readJsonBody(req);
    const saved = store.saveProfile(sanitize(body));
    sendJson(res, 200, { profile: saved });
  });
}

module.exports = { register, FIELDS, AUTHOR_FIELDS };
