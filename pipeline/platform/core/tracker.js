"use strict";
// Модель маршрута подготовки: Депонирование (Роспатент) → Отчуждение права →
// Регистрация перехода в ФИПС → Предпосылки подачи → Требования ПП № 1236 (п. 5) →
// Сведения реестровой записи (п. 4) → Приложения к заявлению (п. 11) →
// Артефакты и проверки → Подача.
//
// Чек-лист — ПРОЕКЦИЯ ДАННЫХ: пункт закрыт тогда и только тогда, когда его
// предикат истинен для {карточка, отчёт, артефакты}. Ручных отметок нет.
// Внешние факты (УКЭП, ЕСИА, долг ЕНС, отправка на портал) — поля карточки.
//
// Три стадии соответствия НЕ описаны здесь списком: их пункты приходят из
// выписки акта (99_reference/pp1236.json) через core/criteria.js. Правка
// требований — это правка справочника, а не кода.

const store = require("./store");
const criteria = require("./criteria");

// Внутренний листинг фрагмента кода — сырьё авто-подготовки, не документ.
const DEPON_RAW = /^dep_codefrag_listing\.txt$/i;

// --- Мелкие помощники предикатов ---
function g(obj, pathStr) { return pathStr.split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }
function ne(v) { return !(v == null || v === "" || (Array.isArray(v) && v.length === 0)); }
function hasArt(ctx, hint) { return ctx.names.some((n) => n.includes(hint)); }
function hasKind(ctx, kind) {
  const prefix = kind.toLowerCase() + "_";
  return ctx.names.some((n) => n.startsWith(prefix) && !DEPON_RAW.test(n));
}
function pass(ctx, checkId) { return ctx.reportById[checkId] === "PASS"; }

// Пункт справочника ПП № 1236 → пункт трекера. Текст пункта — норма и её краткое
// название, чтобы человек видел, ЧЕМУ именно он должен соответствовать.
// counts:false — пункт виден, но в прогресс не входит (неприменим либо отложен).
const STATUS_SUFFIX = { "n/a": " — неприменимо", pending: " — ещё не вступило в силу" };
function complianceItems(list) {
  return (list || []).map((c) => ({
    id: c.id,
    text: `${c.norm}. ${c.title}${STATUS_SUFFIX[c.status] || ""}`,
    done: c.status === "ok",
    status: c.status,
    norm: c.norm,
    reason: c.reason || null,
    counts: c.status === "ok" || c.status === "no",
  }));
}

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
    { id: "gd_chain", text: "Цепочка прав: служебные задания, договоры, акты", kind: "dep_chain" },
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
  // Предпосылки подачи. Это НЕ требования ПП № 1236 — это условия, без которых
  // заявление физически не отправить (подпись, вход, отсутствие долга).
  { id: "card", title: "Предпосылки подачи", link: "", hidden: true, items: [
    { id: "card_ukep", text: "УКЭП на руководителя получена",
      done: (c) => g(c.p, "rightholder.signatory.hasUKEP") === true },
    { id: "card_esia", text: "Учётная запись организации подтверждена в ЕСИА",
      done: (c) => g(c.p, "rightholder.esiaConfirmed") === true },
    { id: "card_ens", text: "Нет задолженности на ЕНС > 3000 ₽",
      done: (c) => g(c.p, "rightholder.noEnsDebt") === true },
  ] },
  // Три стадии ниже строятся из выписки ПП № 1236 (99_reference/pp1236.json):
  // требования п. 5, сведения реестровой записи п. 4, приложения п. 11.
  // Пункты не перечислены здесь намеренно — иначе справочник и код разъедутся.
  { id: "pp1236", title: "Требования к ПО (ПП № 1236, п. 5)", link: "/compliance", hidden: true, from: "requirements" },
  { id: "record", title: "Сведения реестровой записи (п. 4)", link: "/product", hidden: true, from: "recordFields" },
  { id: "attach", title: "Приложения к заявлению (п. 11)", link: "/docs", hidden: true, from: "attachments" },
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
  // Сверка с ПП № 1236 считается один раз и питает три стадии маршрута.
  const compliance = criteria.evaluate(p, report, names);

  let doneTotal = 0, itemsTotal = 0;
  const stages = [];
  for (let i = 0; i < STAGES.length; i++) {
    const s = STAGES[i];
    // Стадия «Подача» зависит от закрытия предыдущих стадий.
    if (s.id === "submit") ctx.prevComplete = stages.every((st) => st.complete);

    const items = s.from
      ? complianceItems(compliance[s.from])
      : s.items
        .filter((it) => !it.applicable || it.applicable(ctx))
        .map((it) => {
          const done = it.kind ? hasKind(ctx, it.kind) : !!it.done(ctx);
          return { id: it.id, text: it.text, done };
        });
    // Пункты со статусом «неприменимо» и «ещё не вступило в силу» показываем,
    // но в знаменатель прогресса не берём — иначе стадия не закроется никогда.
    const counted = items.filter((x) => x.counts !== false);
    const done = counted.filter((x) => x.done).length;
    // Скрытые стадии не считаем в общем прогрессе и не показываем в трекере,
    // пока платформа сфокусирована на роспатентной части.
    if (!s.hidden) { itemsTotal += counted.length; doneTotal += done; }
    stages.push({
      id: s.id, title: s.title, link: s.link || "", hidden: !!s.hidden,
      items, done, total: counted.length,
      complete: counted.length > 0 && done === counted.length,
      percent: counted.length ? Math.round((done / counted.length) * 100) : 100,
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
    // Сводка сверки с актом: можно ли подписывать декларацию п. 10 подп. «г»
    // и какие именно требования пункта 5 этому мешают.
    compliance: {
      act: compliance.act,
      totals: compliance.totals,
      canDeclare: compliance.canDeclareCompliance,
      blocking: compliance.blocking,
    },
  };
}

module.exports = { STAGES, buildTracker };
