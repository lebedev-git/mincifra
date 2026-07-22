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
  ["author.fullName", "string"],
  ["author.birthDate", "string"],
  ["author.citizenship", "string"],
  ["author.snils", "string"],
  ["author.address", "string"],
  ["support.contactFio", "string"],
  ["support.contactEmail", "string"],
  ["support.contactPhone", "string"],
];

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

module.exports = { register, FIELDS };
