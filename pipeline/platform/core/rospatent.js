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

// Реферат по п. 30 Правил (приказ Минэкономразвития № 211).
// Состав: название, назначение, область применения, функциональные возможности;
// могут быть отражены тип ЭВМ и версия ОС; если есть персональные данные — указать.
// Реферат ОБЯЗАН завершаться языком программирования и объёмом в единицах, кратных
// числу байт, — поэтому хвост собирается первым и при нехватке лимита не режется,
// сокращается только описательная часть. Объём реферата ≤ 900 знаков.
function buildReferat(prod, bytes) {
  const p = prod.product || {}, t = prod.tech || {}, reg = prod.registration || {};
  const langs = joinList(p.programmingLanguages);

  // Обязательное завершение (п. 30) — не обрезается.
  const tail = [];
  tail.push(`Язык программирования: ${langs === "—" ? "не указан" : langs}.`);
  tail.push(`Объём программы: ${bytes == null ? "не определён" : bytes + " байт"}.`);
  const tailText = tail.join(" ");

  // Описательная часть.
  const head = [];
  // Точка в конце каждого блока: тексты из package.json часто без неё, иначе
  // предложения склеиваются («…(Минцифры) Тип ЭВМ: …»).
  const dot = (s) => { const t = String(s).trim(); return /[.!?…]$/.test(t) ? t : t + "."; };
  if (p.name) head.push(dot(p.name));
  if (p.description) head.push(dot(p.description));
  if (p.purpose) head.push(dot(`Назначение и область применения: ${String(p.purpose).trim()}`));
  const os = joinList(t.supportedOS);
  if (os !== "—") head.push(`Операционные системы: ${os}.`);
  if (reg.deviceType) head.push(`Тип ЭВМ: ${reg.deviceType}.`);
  // Персональные данные — если обрабатываются, указание в реферате обязательно (п. 30).
  const pdn = prod.personalData || {};
  if (pdn.contains) {
    head.push(`Содержит персональные данные${pdn.operatorRegNumber
      ? ` (регистрационный номер в реестре операторов: ${pdn.operatorRegNumber})` : ""}.`);
  }

  let headText = head.join(" ").replace(/\s+/g, " ").trim();
  const room = REFERAT_LIMIT - tailText.length - 1; // −1 на пробел между частями
  if (headText.length > room) {
    headText = headText.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, "") + "…";
  }
  return (headText ? headText + " " : "") + tailText;
}

// Секция «Заявитель / автор» (физлицо) — Схема B: депонирование оформляется на
// физлицо, поэтому и графа 2 (заявитель-правообладатель), и графа 7А (автор)
// заполняются данными одного человека из профиля.
// Графа 2, п. 13 Правил: идентификаторы российского физлица — ИНН и серия/номер
// документа, удостоверяющего личность; СНИЛС — только «при наличии».
// Графа 7А, п. 20: ФИО, дата рождения, гражданство, место жительства, творческий
// вклад и способ упоминания при публикации.
const MENTION_DEFAULT = "упоминать под своим именем";

// Авторы продукта = привязка из карточки (registration.authors — список ФИО).
// Если привязка не задана, берутся ВСЕ авторы профиля: одиночный автор попадает
// в заявку сам, без ручного выбора. Имена, которых уже нет в профиле, отбрасываются.
function resolveAuthors(prod) {
  const all = store.getProfile().authors || [];
  const picked = (prod.registration && prod.registration.authors) || [];
  if (!picked.length) return all;
  const byName = new Map(all.map((a) => [String(a.fullName).trim(), a]));
  return picked.map((n) => byName.get(String(n).trim())).filter(Boolean);
}

function applicantFields(prod) {
  const authors = resolveAuthors(prod);
  // Схема B: заявитель-правообладатель — первый автор (депонирование на физлицо).
  const a = authors[0] || {};
  const rows = [
    { label: "Графа 2. Заявитель (правообладатель), ФИО", value: val(a.fullName) },
    { label: "Графа 2. Адрес места жительства", value: val(a.address), note: "с указанием страны (RU)" },
    { label: "Графа 2. ИНН", value: val(a.inn), note: "обязателен для российского физлица" },
    { label: "Графа 2. Документ, удостоверяющий личность", value: val(a.passport), note: "серия и номер" },
    { label: "Графа 2. СНИЛС", value: val(a.snils), note: "при наличии" },
    { label: "Графа 7. Всего авторов", value: String(authors.length || 0),
      note: authors.length > 1 ? "сведения о 2-м и последующих — в дополнении к заявлению" : "" },
  ];

  // Графа 7А по каждому автору: первый — в заявлении, остальные — в дополнении.
  authors.forEach((au, i) => {
    const g = authors.length > 1 ? `Графа 7А (автор ${i + 1}${i ? ", дополнение к заявлению" : ""}). ` : "Графа 7А. ";
    rows.push(
      { label: g + "ФИО", value: val(au.fullName) },
      { label: g + "Дата рождения", value: val(au.birthDate) },
      { label: g + "Гражданство", value: val(au.citizenship) },
      { label: g + "Место жительства", value: val(au.address) },
      { label: g + "Творческий вклад", value: val(au.contribution), note: "краткое описание, обязательно" },
      { label: g + "Способ упоминания при публикации", value: au.mentionMode || MENTION_DEFAULT },
    );
  });
  if (!authors.length) {
    rows.push({ label: "Графа 7А. Автор", value: "—", note: "добавьте автора в профиль" });
  }
  return rows;
}

// Сборка экрана «Сведения о программе» + реферат.
function buildGosuslugi(id) {
  const prod = store.getProduct(id);
  const p = prod.product || {}, t = prod.tech || {}, reg = prod.registration || {};
  const bytes = snapshotBytes(id);

  const pub = prod.publication || {};
  const pdn = prod.personalData || {};

  const fields = [
    { label: "Графа 1. Название программы", value: val(p.name) },
    { label: "Графа 3. Персональные данные", value: pdn.contains ? "содержит" : "не содержит" },
    { label: "Графа 3. Номер в реестре операторов ПДн", value: val(pdn.operatorRegNumber),
      note: pdn.contains ? "обязателен, если ПДн обрабатываются" : "не заполняется" },
    { label: "Графа 4. Год создания", value: val(reg.yearCreated) },
    { label: "Графа 5. Страна обнародования", value: val(pub.country),
      note: "только если программа уже выпущена в свет" },
    { label: "Графа 5. Год обнародования", value: val(pub.year), note: "только если выпущена в свет" },
    // Ниже — сведения не из заявления, а из реферата (п. 30) и экранов ЕПГУ.
    { label: "Язык программирования", value: joinList(p.programmingLanguages), note: "для реферата" },
    { label: "Операционная система", value: joinList(t.supportedOS), note: "для реферата, при наличии" },
    { label: "Тип ЭВМ", value: val(reg.deviceType), note: "для реферата" },
    { label: "Объём (в байтах)", value: bytes == null ? "—" : String(bytes),
      note: bytes == null ? "загрузите снимок кода" : bytesHuman(bytes) },
    { label: "Единица информации", value: bytes == null ? "—" : "байт" },
  ];

  const applicant = applicantFields(prod);
  const authorFilled = resolveAuthors(prod).length > 0;
  const referat = buildReferat(prod, bytes);
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
  if (!Array.isArray(p.programmingLanguages) || !p.programmingLanguages.length) {
    const langs = inferLanguages(id);
    if (langs.length) { prod.product = p; p.programmingLanguages = langs; }
  }

  store.saveProduct(id, prod);
  return buildGosuslugi(id);
}

module.exports = { buildGosuslugi, autofill, buildReferat, resolveAuthors, snapshotBytes, REFERAT_LIMIT };
