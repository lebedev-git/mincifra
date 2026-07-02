"use strict";
// Генерация документов подготовки к депонированию (Роспатент) из карточки продукта.
// Переиспользует docx-хелперы пакета досье. Чистая логика: каждая make-функция
// возвращает массив параграфов/таблиц; сборка в .docx — через H.build.
//
// listDeponDocs() -> [{ kind, title, make(product, ctx) }]
//   kind    — категория артефакта (dep_referat, dep_snapshot, dep_chain, dep_stat);
//             сгенерированный файл сохраняется с префиксом kind_ и закрывает пункт трекера.
//   make    — построитель; ctx может содержать { hash, archiveName, sizeBytes } для акта фиксации.
//
// ВНИМАНИЕ: правовые формулировки — шаблонные каркасы, проверяет юрист правообладателя.

const H = require("./lib/docx_helpers");
const { H1, P, bullet, num, R, B, sp, pageBreak, note, tbl, titleBlock, build } = H;

function today() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
function safeFileName(s) {
  return String(s || "").replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, " ").trim();
}
function asList(v) { return Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]); }
function fmtBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "____";
  if (v >= 1048576) return `${(v / 1048576).toFixed(2)} МБ`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} КБ`;
  return `${v} байт`;
}

// ---------- Реферат программы для ЭВМ ----------
function docReferat(pr) {
  const p = pr.product || {}, rh = pr.rightholder || {}, t = pr.tech || {}, r = pr.rights || {};
  const authors = asList(r.authors);
  const langs = asList(p.programmingLanguages);
  const c = [];
  c.push(...titleBlock("РЕФЕРАТ", "программы для ЭВМ", [`Дата: ${today()}`]));
  c.push(sp(200));
  c.push(tbl([3400, 5960], ["Поле", "Значение"], [
    ["Название программы", p.name || "____"],
    ["Правообладатель", `${rh.orgName || "____"} (ИНН ${rh.inn || "____"}, ОГРН ${rh.ogrn || "____"})`],
    ["Автор(ы)", authors.length ? authors.join(", ") : "— указать ФИО —"],
    ["Язык(и) программирования", langs.length ? langs.join(", ") : "— указать —"],
    ["Операционные системы", asList(t.supportedOS).join(", ") || "— указать —"],
    ["Объём программы", "— указать (напр. 12 МБ) —"],
    ["Год создания", String(new Date().getFullYear())],
  ]));
  c.push(sp());
  c.push(H1("Аннотация"));
  c.push(P(p.description || "— описание функциональных характеристик —"));
  c.push(P([B("Назначение: "), R(p.purpose || "— область применения —")]));
  c.push(P([B("Графический интерфейс: "), R("на русском языке.")]));
  c.push(sp());
  c.push(note("Заполнить вручную", [R("Поля «— указать —» и объём программы вписать перед подачей. Реферат для формы госрегистрации ДоЭВМ (Роспатент/ФИПС).")]));
  return c;
}

// ---------- Акт фиксации версии (снимок кода + хеш) ----------
function docSnapshotAct(pr, ctx = {}) {
  const p = pr.product || {}, rh = pr.rightholder || {};
  const c = [];
  c.push(...titleBlock("АКТ ФИКСАЦИИ ВЕРСИИ", "исходного кода программы для ЭВМ", [`Дата: ${today()}`]));
  c.push(sp(200));
  c.push(P([R("Настоящий акт фиксирует версию исходного кода программы "), B(p.name || "____"),
    R(", права на которую принадлежат "), B(`${rh.orgName || "____"} (ИНН ${rh.inn || "____"})`),
    R(". Контрольная сумма подтверждает неизменность зафиксированной версии на указанную дату.")]));
  c.push(sp());
  c.push(tbl([3400, 5960], ["Параметр", "Значение"], [
    ["Файл архива", ctx.archiveName || "— архив не загружен —"],
    ["Размер", fmtBytes(ctx.sizeBytes)],
    ["Алгоритм хеширования", "SHA-256"],
    [new H.docx.Paragraph({ children: [B("Контрольная сумма (SHA-256)")] }),
     new H.docx.Paragraph({ children: [new H.docx.TextRun({ text: ctx.hash || "— вычисляется при загрузке архива —", font: "Consolas", size: 18 })] })],
    ["Дата и время фиксации", ctx.stampedAt || today()],
  ]));
  c.push(sp());
  c.push(P([B("Версия зафиксирована. "), R("Хранить архив и настоящий акт совместно — они образуют доказательство версии на дату.")]));
  c.push(sp(240));
  c.push(P([R("Уполномоченное лицо: _______________________ / "), B(rh.signatory ? rh.signatory.name : "___________________"), R("  М.П.")]));
  c.push(sp());
  c.push(note("Что это даёт", [R("Акт с SHA-256 — техническое доказательство «этот код был у нас на эту дату». Не заменяет свидетельство Роспатента, но усиливает цепочку прав и полезен при аудите подозрения.")]));
  return c;
}

// ---------- Цепочка прав: служебное задание + акт + договор отчуждения ----------
function docChain(pr) {
  const p = pr.product || {}, rh = pr.rightholder || {}, r = pr.rights || {};
  const authors = asList(r.authors);
  const c = [];
  c.push(...titleBlock("ЦЕПОЧКА ПРАВ", "служебное произведение (ст. 1295 ГК РФ)", [`Продукт: ${p.name || "____"}`, `Дата: ${today()}`]));
  c.push(pageBreak());

  c.push(H1("1. Служебное задание"));
  c.push(P([R("ООО/АО "), B(rh.orgName || "____"), R(" (работодатель) поручает работнику(ам) разработку программы для ЭВМ "),
    B(p.name || "____"), R(" в рамках трудовых обязанностей (ст. 1295 ГК РФ).")]));
  c.push(P([B("Работник(и): "), R(authors.length ? authors.join(", ") : "— ФИО, должность —")]));
  c.push(bullet("Предмет: разработка исходного кода, документации и связанных материалов."));
  c.push(bullet("Срок выполнения: с «__» ________ 20__ г. по «__» ________ 20__ г."));
  c.push(bullet("Результат передаётся работодателю; исключительное право возникает у работодателя."));
  c.push(sp());

  c.push(H1("2. Акт приёмки служебного произведения"));
  c.push(P([R("Работодатель принял результат — программу "), B(p.name || "____"),
    R(". Исключительное право на произведение в полном объёме принадлежит работодателю "), B(rh.orgName || "____"), R(".")]));
  if (authors.length) {
    c.push(tbl([700, 5300, 3360], ["№", "Автор", "Подпись / дата"],
      authors.map((a, i) => [String(i + 1), a, "_______________ / __.__.20__"])));
  } else {
    c.push(P([R("Авторы: — заполнить (добавьте авторов в карточку продукта) —")]));
  }
  c.push(sp());

  c.push(H1("3. Договор отчуждения (для подрядчиков)"));
  c.push(P([R("Если код создавали подрядчики (не работники), исключительное право передаётся по договору отчуждения (ст. 1234 ГК РФ) или авторского заказа (ст. 1288 ГК РФ). Применять вместо раздела 1–2 для соответствующих лиц.")]));
  c.push(sp());
  c.push(note("Дисклеймер", [R("Каркас документов. Обязательно проверить и подписать у юриста правообладателя; на каждого автора оформляется свой комплект.")]));
  return c;
}

// ---------- Заявление в Роспатент (форма ДоЭВМ) ----------
function docStatement(pr) {
  const p = pr.product || {}, rh = pr.rightholder || {}, r = pr.rights || {};
  const authors = asList(r.authors);
  const langs = asList(p.programmingLanguages);
  const sig = rh.signatory || {};
  const c = [];
  c.push(...titleBlock("ЗАЯВЛЕНИЕ", "о государственной регистрации программы для ЭВМ", [`Дата: ${today()}`]));
  c.push(sp(160));
  c.push(P([R("В Федеральную службу по интеллектуальной собственности (Роспатент / ФИПС).")]));
  c.push(sp());
  c.push(tbl([3400, 5960], ["Поле формы", "Значение"], [
    ["Название программы", p.name || "____"],
    ["Правообладатель", rh.orgName || "____"],
    ["ОГРН / ИНН", `${rh.ogrn || "____"} / ${rh.inn || "____"}`],
    ["Адрес правообладателя", rh.address || "____"],
    ["Автор(ы)", authors.length ? authors.join("; ") : "— указать ФИО —"],
    ["Язык(и) программирования", langs.length ? langs.join(", ") : "— указать —"],
    ["Реферат", "прилагается (см. отдельный документ)"],
    ["Идентифицирующие материалы", "фрагмент исходного кода (до 70 стр.), прилагается"],
  ]));
  c.push(sp());
  c.push(P([R("Прошу зарегистрировать указанную программу для ЭВМ и внести сведения в Реестр программ для ЭВМ.")]));
  c.push(sp(240));
  c.push(P([R("Руководитель: "), B(sig.name || "___________________"),
    R(sig.position ? ` (${sig.position})` : ""), R("  _______________  М.П.")]));
  c.push(P([R("Заявление подписывается УКЭП организации при подаче на "), B("fips.ru"), R(".")]));
  c.push(sp());
  c.push(note("Пошлина", [[R("Госпошлина за регистрацию программы для ЭВМ — "), B("СВЕРИТЬ на fips.ru"), R(" (ориентир ≈ 4500 ₽ для юрлица).")]]));
  return c;
}

// Состав генерируемых документов депонирования.
function listDeponDocs() {
  return [
    { kind: "dep_referat", title: "Реферат программы", file: "Реферат", make: docReferat },
    { kind: "dep_snapshot", title: "Акт фиксации версии", file: "Акт_фиксации_версии", make: docSnapshotAct, needsArchive: true },
    { kind: "dep_chain", title: "Цепочка прав", file: "Цепочка_прав", make: docChain },
    { kind: "dep_statement", title: "Заявление в Роспатент", file: "Заявление_Роспатент", make: docStatement },
  ];
}

// Генерация одного документа в Buffer. Возвращает { fileName, buffer } — сохранение
// (в data-слой) делает вызывающий адаптер. tmpPath используется только для сборки.
async function buildDeponDoc(kind, product, ctx = {}) {
  const def = listDeponDocs().find((d) => d.kind === kind);
  if (!def) throw new Error(`Неизвестный документ депонирования: ${kind}`);
  const short = safeFileName((product.product && product.product.shortName) || "product");
  const fileName = `${def.file}_${short}.docx`;
  const children = def.make(product, ctx);
  const os = require("os"), path = require("path"), fs = require("fs");
  const tmp = path.join(os.tmpdir(), `depon_${kind}_${Date.now()}.docx`);
  await build(children, { title: def.title, header: `${def.title} · ${short}`, outPath: tmp });
  const buffer = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  return { fileName, buffer, title: def.title };
}

module.exports = { listDeponDocs, buildDeponDoc, today };
