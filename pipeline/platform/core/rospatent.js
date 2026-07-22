"use strict";
// Монтажный лист формы «Государственная регистрация программы для ЭВМ» (Госуслуги / ФИПС).
// Экран мастера «Сведения о программе» + текст реферата (≤ 900 символов).
// Данные берутся из карточки продукта и снимка кода (размер архива — поле «Объём»).
// Аналог submission.js (портал реестра), но под форму ДоЭВМ.

const fs = require("fs");
const store = require("./store");

const REFERAT_LIMIT = 900;

function val(x, dash = "—") { return (x === undefined || x === null || x === "") ? dash : x; }
function joinList(a) { return Array.isArray(a) ? a.filter(Boolean).join(", ") || "—" : val(a); }

// Артефакт снимка кода: dep_snapshot_* (не сгенерированный .docx).
function snapshotArtifact(id) {
  return store.listArtifacts(id)
    .find((a) => /^dep_snapshot_/i.test(a.name) && !/\.docx$/i.test(a.name)) || null;
}

// Размер снимка в байтах — поле «Объём в единицах информации, кратных числу байт».
function snapshotBytes(id) {
  const art = snapshotArtifact(id);
  if (!art) return null;
  try { return fs.statSync(store.artifactPath(id, art.name)).size; }
  catch (_) { return null; }
}

// Человекочитаемый размер — только для подсказки рядом с полем.
function bytesHuman(n) {
  if (n == null) return "—";
  if (n >= 1048576) return `${(n / 1048576).toFixed(2)} МБ`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${n} байт`;
}

// Тип ЭВМ по модели поставки (эвристика для автозаполнения).
function inferDeviceType(p) {
  const dt = String(p.deliveryType || "").toUpperCase();
  if (dt === "SAAS") return "Сервер (x86-64)";
  if (dt === "ON-PREM" || dt === "ON_PREM") return "Персональный компьютер / сервер (x86-64)";
  return "Персональный компьютер / сервер";
}

// Год создания: по дате снимка кода, иначе — текущий год.
function inferYear(id) {
  const art = snapshotArtifact(id);
  if (art) {
    try { return String(new Date(fs.statSync(store.artifactPath(id, art.name)).mtime).getFullYear()); }
    catch (_) { /* fallthrough */ }
  }
  return String(new Date().getFullYear());
}

// Реферат ≤ 900 символов (plain-text) из описания и назначения карточки.
function buildReferat(p) {
  const parts = [];
  if (p.description) parts.push(String(p.description).trim());
  if (p.purpose) parts.push(`Назначение: ${String(p.purpose).trim()}`);
  const langs = joinList(p.programmingLanguages);
  if (langs !== "—") parts.push(`Язык программирования: ${langs}.`);
  parts.push("Графический интерфейс — на русском языке.");
  let text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (text.length > REFERAT_LIMIT) {
    text = text.slice(0, REFERAT_LIMIT - 1).replace(/\s+\S*$/, "") + "…";
  }
  return text;
}

// Секция «Заявитель / автор» (физлицо) — Схема B: депонирование оформляется на
// физлицо, поэтому в форме Госуслуг эти поля заполняются данными автора из профиля.
function applicantFields() {
  const a = store.getProfile().author || {};
  return [
    { label: "Заявитель / автор (ФИО)", value: val(a.fullName) },
    { label: "Дата рождения", value: val(a.birthDate) },
    { label: "Гражданство", value: val(a.citizenship) },
    { label: "СНИЛС", value: val(a.snils) },
    { label: "Адрес места жительства", value: val(a.address) },
  ];
}

// Сборка экрана «Сведения о программе» + реферат.
function buildGosuslugi(id) {
  const prod = store.getProduct(id);
  const p = prod.product || {}, t = prod.tech || {}, reg = prod.registration || {};
  const bytes = snapshotBytes(id);

  const fields = [
    { label: "Название", value: val(p.name) },
    { label: "Язык программирования", value: joinList(p.programmingLanguages) },
    { label: "Операционная система", value: joinList(t.supportedOS), note: "при наличии" },
    { label: "Тип ЭВМ", value: val(reg.deviceType), note: "тип устройства" },
    { label: "Объём (в байтах)", value: bytes == null ? "—" : String(bytes),
      note: bytes == null ? "загрузите снимок кода" : bytesHuman(bytes) },
    { label: "Единица информации", value: bytes == null ? "—" : "байт" },
    { label: "Год создания", value: val(reg.yearCreated) },
    { label: "Является компонентом ГИС", value: reg.gisComponent ? "да" : "нет" },
  ];

  const applicant = applicantFields();
  const authorFilled = applicant.some((f) => f.value !== "—");
  const referat = buildReferat(p);
  return {
    productId: id,
    productName: p.name || id,
    applicant,
    authorFilled,
    fields,
    referat,
    referatLen: referat.length,
    referatLimit: REFERAT_LIMIT,
    hasSnapshot: bytes != null,
  };
}

// «Заполнить автоматически»: пишет выводимые поля прямо в карточку.
// Детерминированно и офлайн. Не перезаписывает то, что уже заполнил человек.
// Язык программирования — из листинга исходников (заголовки «// Файл: …»):
// считаем расширения, отдаём до трёх самых частых языков.
const EXT_LANG = {
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  ts: "TypeScript", tsx: "TypeScript",
  py: "Python", rb: "Ruby", php: "PHP", go: "Go", rs: "Rust",
  java: "Java", kt: "Kotlin", swift: "Swift", cs: "C#",
  c: "C", h: "C", cpp: "C++", hpp: "C++", cc: "C++",
  vue: "JavaScript", svelte: "JavaScript", sql: "SQL",
};
function inferLanguages(id) {
  try {
    const p = store.artifactPath(id, "dep_codefrag_listing.txt");
    if (!fs.existsSync(p)) return [];
    const text = fs.readFileSync(p, "utf8");
    const counts = {};
    for (const m of text.matchAll(/Файл:\s*\S+\.([A-Za-z0-9]+)\s*$/gm)) {
      const lang = EXT_LANG[m[1].toLowerCase()];
      if (lang) counts[lang] = (counts[lang] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l);
  } catch (_) { return []; }
}

function autofill(id) {
  const prod = store.getProduct(id);
  const p = prod.product || {};
  prod.registration = prod.registration || {};
  const reg = prod.registration;

  if (!reg.deviceType) reg.deviceType = inferDeviceType(p);
  if (!reg.yearCreated) reg.yearCreated = inferYear(id);
  if (reg.gisComponent === undefined) reg.gisComponent = false;
  if (!Array.isArray(p.programmingLanguages) || !p.programmingLanguages.length) {
    const langs = inferLanguages(id);
    if (langs.length) { prod.product = p; p.programmingLanguages = langs; }
  }

  store.saveProduct(id, prod);
  return buildGosuslugi(id);
}

module.exports = { buildGosuslugi, autofill, REFERAT_LIMIT };
