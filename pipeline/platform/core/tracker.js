"use strict";
// Модель маршрута подготовки: Депонирование (Роспатент) → Отчуждение права →
// Регистрация перехода в ФИПС → Карточка (ООО) → Продукт → Артефакты/проверки →
// Подача. Чек-лист — ПРОЕКЦИЯ ДАННЫХ: каждый пункт закрыт
// тогда и только тогда, когда его предикат истинен для {карточка, отчёт, артефакты}.
// Ручных отметок нет — статус нельзя «поставить», он вычисляется из данных.
// Внешние факты (УКЭП, ЕСИА, долг ЕНС, сверка ПП №325, отправка на портал) —
// это поля карточки, а не отдельное состояние.

const store = require("./store");
const { pp325AppliesTo } = require("./class_hint");

// Внутренний листинг фрагмента кода — сырьё авто-подготовки, не документ.
const DEPON_RAW = /^dep_codefrag_listing\.txt$/i;

// --- Мелкие помощники предикатов ---
function g(obj, pathStr) { return pathStr.split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }
function ne(v) { return !(v == null || v === "" || (Array.isArray(v) && v.length === 0)); }
function arr(v) { return Array.isArray(v) ? v : []; }
function toNum(v) { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function hasArt(ctx, hint) { return ctx.names.some((n) => n.includes(hint)); }
function hasKind(ctx, kind) {
  const prefix = kind.toLowerCase() + "_";
  return ctx.names.some((n) => n.startsWith(prefix) && !DEPON_RAW.test(n));
}
function pass(ctx, checkId) { return ctx.reportById[checkId] === "PASS"; }

// --- Определение стадий ---
// item.done(ctx) — предикат. item.applicable(ctx) (опц.) — показывать ли пункт.
// stage.link — куда ведёт клик по стадии/пункту (относительно #/p/:id).
// Порядок стадий = логический маршрут «от Роспатента к реестру»:
//   депонирование (физлицо) → отчуждение права → регистрация перехода в ФИПС →
//   предпосылки ООО (карточка) → продукт → проверки → подача в Минцифру.
const STAGES = [
  { id: "depon", title: "Депонирование (Роспатент)", link: "/docs", items: [
    { id: "gd_snapshot", text: "Снимок версии кода + акт фиксации (SHA-256)", kind: "dep_snapshot" },
    { id: "gd_referat", text: "Реферат программы", kind: "dep_referat" },
    { id: "gd_codefrag", text: "Фрагмент исходного кода (до 50 стр.)", kind: "dep_codefrag" },
    { id: "gd_statement", text: "Заявление в Роспатент, подписанное УКЭП", kind: "dep_statement" },
    { id: "gd_cert", text: "Свидетельство о госрегистрации ПО", kind: "dep_cert" },
  ] },
  // Стадии трека Минцифры (отчуждение → ФИПС → карточка → продукт → проверки → подача)
  // скрыты: платформа сфокусирована ТОЛЬКО на подаче в Роспатент. Логика цела —
  // снять hidden, когда понадобится реестр.
  { id: "assign", title: "Отчуждение права (физлицо → ООО)", link: "/docs", hidden: true, items: [
    { id: "as_contract", text: "Договор отчуждения исключительного права (ст. 1234 ГК)", kind: "dep_assign_contract" },
    { id: "as_act", text: "Акт приёма-передачи", kind: "dep_assign_act" },
  ] },
  { id: "register", title: "Регистрация перехода в ФИПС (ст. 1232)", link: "/docs", hidden: true, items: [
    { id: "rg_statement", text: "Заявление о регистрации отчуждения (ст. 1232 п.2, 1262 п.5)", kind: "dep_assign_register" },
    { id: "rg_notice", text: "Уведомление ФИПС о состоявшейся регистрации перехода",
      done: (c) => g(c.p, "rights.transferRegistered") === true },
  ] },
  { id: "card", title: "Карточка", link: "", hidden: true, items: [
    { id: "card_org", text: "Правообладатель — рос. юрлицо, РФ-контроль > 50%",
      done: (c) => ne(g(c.p, "rightholder.orgName")) && ne(g(c.p, "rightholder.inn")) && (toNum(g(c.p, "rightholder.ruControlSharePercent")) || 0) > 50 },
    { id: "card_ukep", text: "УКЭП на руководителя получена",
      done: (c) => g(c.p, "rightholder.signatory.hasUKEP") === true },
    { id: "card_esia", text: "Учётная запись организации подтверждена в ЕСИА",
      done: (c) => g(c.p, "rightholder.esiaConfirmed") === true },
    { id: "card_ens", text: "Нет задолженности на ЕНС > 3000 ₽",
      done: (c) => g(c.p, "rightholder.noEnsDebt") === true },
    { id: "card_pp325", text: "Доптребования ПП № 325 сверены",
      applicable: (c) => pp325AppliesTo(arr(g(c.p, "product.class"))),
      done: (c) => g(c.p, "compliance.pp325Checked") === true },
    { id: "card_fin", text: "Указаны выручка и выплаты иностранцам",
      done: (c) => toNum(g(c.p, "finance.annualRevenueProduct")) !== null && toNum(g(c.p, "finance.annualForeignPayments")) !== null },
  ] },
  { id: "product", title: "Продукт", link: "/product", hidden: true, items: [
    { id: "prod_class", text: "Определён класс ПО (СВЕРИТЬ по ПП № 1236)",
      done: (c) => arr(g(c.p, "product.class")).length > 0 },
    { id: "prod_core", text: "Наименование, модель поставки, описание",
      done: (c) => ne(g(c.p, "product.name")) && ne(g(c.p, "product.deliveryType")) && ne(g(c.p, "product.description")) },
    { id: "prod_url", text: "Публичный URL страницы продукта",
      done: (c) => ne(g(c.p, "product.productPageUrl")) },
    { id: "prod_contacts", text: "Контакты техподдержки в РФ",
      done: (c) => ne(g(c.p, "support.contactsRu")) },
    { id: "prod_price", text: "Опубликован порядок ценообразования / прайс",
      done: (c) => ne(g(c.p, "product.pricingUrl")) },
    { id: "prod_demo", text: "Демо/экземпляр для эксперта",
      done: (c) => ne(g(c.p, "product.expertDemo.url")) },
    { id: "prod_lifecycle", text: "Документация жизненного цикла",
      done: (c) => ne(g(c.p, "support.lifecycleDocUrl")) },
  ] },
  { id: "checks", title: "Артефакты и проверки", link: "/checks", hidden: true, items: [
    { id: "chk_sbom", text: "SBOM загружен",
      done: (c) => hasArt(c, "sbom") || hasArt(c, "cyclonedx") || hasArt(c, "bom") },
    { id: "chk_har", text: "Сетевой аудит (HAR) загружен",
      done: (c) => hasArt(c, "network") || hasArt(c, ".har") },
    { id: "chk_30", text: "Правило 30% — выплаты иностранцам < 30%", done: (c) => pass(c, "foreign_payments") },
    { id: "chk_lic", text: "Лицензии OSS — нет GPL/AGPL/no-license", done: (c) => pass(c, "license_scan") },
    { id: "chk_net", text: "Сетевой аудит — нет обращений за рубеж", done: (c) => pass(c, "network_audit") },
    { id: "chk_page", text: "Страница продукта — атрибуты в норме", done: (c) => pass(c, "page_check") },
  ] },
  { id: "submit", title: "Подача", link: "/submit", hidden: true, items: [
    { id: "sub_ready", text: "Все предыдущие стадии закрыты", done: (c) => c.prevComplete },
    { id: "sub_ukep", text: "Заявление подписано УКЭП", done: (c) => g(c.p, "rightholder.signatory.hasUKEP") === true },
    { id: "sub_sent", text: "Отправлено на проверку на портале", done: (c) => g(c.p, "submission.sentToPortal") === true },
  ] },
];

// Строит проекцию маршрута для продукта id.
function buildTracker(id) {
  const p = store.getProduct(id);
  const report = store.getReport(id);
  const names = (store.listArtifacts(id) || [])
    .map((a) => String(a && a.name ? a.name : a).toLowerCase());
  const reportById = {};
  (report && report.results ? report.results : []).forEach((r) => { reportById[r.id] = r.status; });

  const ctx = { p, report, names, reportById, prevComplete: false };

  let doneTotal = 0, itemsTotal = 0;
  const stages = [];
  for (let i = 0; i < STAGES.length; i++) {
    const s = STAGES[i];
    // Стадия «Подача» зависит от закрытия стадий 1–4.
    if (s.id === "submit") ctx.prevComplete = stages.every((st) => st.complete);

    const items = s.items
      .filter((it) => !it.applicable || it.applicable(ctx))
      .map((it) => {
        const done = it.kind ? hasKind(ctx, it.kind) : !!it.done(ctx);
        return { id: it.id, text: it.text, done };
      });
    const done = items.filter((x) => x.done).length;
    // Скрытые стадии (checks/submit) не считаем в прогрессе и не показываем в трекере,
    // пока платформа сфокусирована на роспатентной части.
    if (!s.hidden) { itemsTotal += items.length; doneTotal += done; }
    stages.push({
      id: s.id, title: s.title, link: s.link || "", hidden: !!s.hidden,
      items, done, total: items.length,
      complete: items.length > 0 && done === items.length,
      percent: items.length ? Math.round((done / items.length) * 100) : 100,
    });
  }

  const next = stages.find((s) => !s.hidden && !s.complete);
  return {
    productId: id,
    stages,
    nextStageId: next ? next.id : null,
    percent: itemsTotal ? Math.round((doneTotal / itemsTotal) * 100) : 0,
    done: doneTotal, total: itemsTotal,
    hasReport: !!report,
    checksOverall: report ? report.overall : null,
  };
}

module.exports = { STAGES, buildTracker };
