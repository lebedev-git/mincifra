"use strict";
// Статусная машина права (Схема B: депонирование на физлицо → отчуждение → ООО).
// Статус НЕ хранится отдельным полем-«правдой», а ВЫЧИСЛЯЕТСЯ из фактов карточки —
// как гейты G3/GD (авто из отчёта/артефактов). Это исключает рассинхрон.
//
//   draft               · ничего не подано
//   dep_submitted       · подано в Роспатент, ждём свидетельство (флаг rights.depSubmitted)
//   dep_granted         · свидетельство ПрЭВМ на физлицо получено (№ + дата заполнены)
//   assigned            · договор отчуждения + акт подписаны (цепочка прав оформлена)
//   transfer_registered · переход права зарегистрирован в ФИПС (ст.1232/1262 п.5) → Минцифра открыта
//
// Юр-основание финального шага: переход исключительного права на ЗАРЕГИСТРИРОВАННУЮ
// в Роспатенте программу сам подлежит госрегистрации в ФИПС (ст.1232 п.2, ст.1262 п.5 ГК).
// Без регистрации перехода он считается несостоявшимся — реестр Минцифры завернёт цепочку.
//
// Факты берутся из карточки:
//   rights.depSubmitted            — подано в Роспатент (ручной внешний факт)
//   rights.rospatentCertificateNumber / ...Date — свидетельство получено
//   rights.chainOfTitleComplete    — договор отчуждения + акт оформлены
//   rights.transferRegistered      — ФИПС зарегистрировал переход (+ ...Number/...Date)

const STATES = ["draft", "dep_submitted", "dep_granted", "assigned", "transfer_registered"];

const META = {
  draft:               { label: "Черновик",                 tone: "muted", hint: "Депонирование ещё не подано в Роспатент." },
  dep_submitted:       { label: "Подано в Роспатент",       tone: "warn",  hint: "Ждём свидетельство ПрЭВМ на физлицо." },
  dep_granted:         { label: "Свидетельство получено",   tone: "info",  hint: "Право на физлице. Нужно отчуждение в пользу ООО." },
  assigned:            { label: "Договор отчуждения подписан", tone: "info", hint: "Договор+акт есть. Нужно зарегистрировать переход в ФИПС (ст.1232)." },
  transfer_registered: { label: "Переход зарегистрирован в ФИПС", tone: "ok", hint: "Право у ООО и переход зарегистрирован — можно подавать в Минцифру." },
};

function notEmpty(x) { return x !== undefined && x !== null && String(x).trim() !== ""; }

// Вычисление статуса из фактов карточки. Порядок проверок — от старшего к младшему.
function computeState(product) {
  const r = (product && product.rights) || {};
  const hasCert = notEmpty(r.rospatentCertificateNumber) && notEmpty(r.rospatentCertificateDate);

  if (hasCert && r.chainOfTitleComplete === true && r.transferRegistered === true) return "transfer_registered";
  if (hasCert && r.chainOfTitleComplete === true) return "assigned";
  if (hasCert) return "dep_granted";
  if (r.depSubmitted === true) return "dep_submitted";
  return "draft";
}

function stateMeta(state) {
  return META[state] || META.draft;
}

// Минцифра открыта только когда переход права зарегистрирован в ФИПС.
function canSubmitReestr(product) {
  return computeState(product) === "transfer_registered";
}

// Этап отчуждения имеет смысл только после получения свидетельства.
function canAssign(product) {
  const s = computeState(product);
  return s === "dep_granted" || s === "assigned" || s === "transfer_registered";
}

// Регистрацию перехода в ФИПС можно готовить, когда договор отчуждения уже оформлен.
function canRegisterTransfer(product) {
  const s = computeState(product);
  return s === "assigned" || s === "transfer_registered";
}

module.exports = { STATES, META, computeState, stateMeta, canSubmitReestr, canAssign, canRegisterTransfer };
