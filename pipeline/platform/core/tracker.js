"use strict";
// Модель трекера гейтов G0–G5 (отражает 01_tracker/pipeline_tracker.md).
// Определяет состав пунктов и считает готовность. Статусы пунктов хранятся
// в data-слое (store.saveTracker/getTracker) как { [itemId]: boolean }.
// Гейт G3 (техготовность) выводится из отчёта проверок, а не отмечается вручную.
// Гейт GD (депонирование) выводится из загруженных артефактов dep_*.

const store = require("./store");

// Внутренний листинг фрагмента кода — сырьё авто-подготовки, не считается документом.
const DEPON_RAW = /^dep_codefrag_listing\.txt$/i;

// Определение гейтов. auto:true — пункт вычисляется из проверок (не редактируется).
// artifacts:true — пункт вычисляется из наличия файла dep_* (тоже не редактируется).
const GATES = [
  { id: "G0", title: "Предпосылки", items: [
    { id: "g0_ru", text: "Правообладатель — рос. юрлицо, РФ-контроль > 50%" },
    { id: "g0_ukep", text: "УКЭП на руководителя получена" },
    { id: "g0_esia", text: "Учётная запись организации подтверждена в ЕСИА" },
    { id: "g0_class", text: "Определён класс ПО (СВЕРИТЬ по ПП № 1236)" },
    { id: "g0_extra", text: "Проверены доптребования (ПП № 325) — СВЕРИТЬ" },
    { id: "g0_ens", text: "Нет задолженности на ЕНС > 3000 ₽" },
  ] },
  { id: "G1", title: "Пакет документов", items: [
    { id: "g1_rights", text: "Документы на исключительное право (Роспатент/служебные)" },
    { id: "g1_egrul", text: "Выписка ЕГРЮЛ, структура владения" },
    { id: "g1_fin", text: "Бухсправка о выплатах иностранцам < 30%" },
    { id: "g1_tech", text: "Тех. документация (функции, руководства, ЖЦ)" },
    { id: "g1_demo", text: "Экземпляр/демо-доступ для эксперта" },
    { id: "g1_sbom", text: "SBOM + заключение о лицензионной чистоте" },
  ] },
  // Депонирование (Роспатент) — отдельный этап после G1. Пункты закрываются
  // автоматически, когда на «Документах» появляется файл с соответствующим
  // префиксом kind_ (загружен вручную или сгенерирован). link — куда ведёт
  // клик по кружку GD в степпере.
  { id: "GD", title: "Депонирование (Роспатент)", artifacts: true, link: "/docs", items: [
    { id: "gd_snapshot", text: "Снимок версии кода + акт фиксации (SHA-256)", kind: "dep_snapshot" },
    { id: "gd_referat", text: "Реферат программы", kind: "dep_referat" },
    { id: "gd_codefrag", text: "Фрагмент исходного кода (до 70 стр.)", kind: "dep_codefrag" },
    { id: "gd_chain", text: "Цепочка прав (служебные задания, договоры, акты)", kind: "dep_chain" },
    { id: "gd_statement", text: "Заявление в Роспатент, подписанное УКЭП", kind: "dep_statement" },
    { id: "gd_cert", text: "Свидетельство о госрегистрации ПО", kind: "dep_cert" },
  ] },
  { id: "G2", title: "Страница продукта", items: [
    { id: "g2_url", text: "Публичный URL, доступен из инкогнито" },
    { id: "g2_content", text: "Опубликованы функции, установка, ЖЦ, ТП" },
    { id: "g2_contacts", text: "Контакты техподдержки в РФ" },
    { id: "g2_price", text: "Порядок ценообразования / прайс опубликован" },
    { id: "g2_ru_host", text: "Сайт хостится в РФ" },
  ] },
  { id: "G3", title: "Техническая готовность", auto: true, items: [
    { id: "g3_30", text: "Правило 30% — выплаты иностранцам < 30%", check: "foreign_payments" },
    { id: "g3_lic", text: "Лицензии OSS — нет GPL/AGPL/no-license", check: "license_scan" },
    { id: "g3_net", text: "Сетевой аудит — нет обращений за рубеж", check: "network_audit" },
    { id: "g3_page", text: "Страница продукта — атрибуты в норме", check: "page_check" },
  ] },
  { id: "G4", title: "Подача на портале", items: [
    { id: "g4_auth", text: "Авторизация на reestr.digital.gov.ru через ЕСИА" },
    { id: "g4_card", text: "Заполнена карточка ПО" },
    { id: "g4_docs", text: "Приложены документы (СВЕРИТЬ форматы)" },
    { id: "g4_decl", text: "Указаны сведения о соответствии ПП № 1236" },
    { id: "g4_ukep", text: "Заявление подписано УКЭП" },
    { id: "g4_send", text: "Нажато «Отправить документы на проверку»" },
  ] },
  { id: "G5", title: "Сопровождение", items: [
    { id: "g5_track", text: "Статус отслеживается в личном кабинете" },
    { id: "g5_reply", text: "Ответы эксперту в срок" },
    { id: "g5_formal", text: "Формальная проверка пройдена" },
    { id: "g5_expert", text: "Содержательная экспертиза пройдена" },
    { id: "g5_order", text: "Приказ Минцифры о включении получен" },
  ] },
];

// Строит статус пункта G3 из отчёта проверок: PASS→true, иначе false.
function autoStateFromReport(report) {
  const map = {};
  const byId = {};
  (report && report.results ? report.results : []).forEach((r) => { byId[r.id] = r.status; });
  for (const gate of GATES) {
    if (!gate.auto) continue;
    for (const it of gate.items) {
      map[it.id] = byId[it.check] === "PASS";
    }
  }
  return map;
}

// Строит статус пунктов GD из артефактов: файл с префиксом kind_ есть → true.
function autoStateFromArtifacts(id) {
  const names = (store.listArtifacts(id) || [])
    .map((a) => String(a && a.name ? a.name : a).toLowerCase());
  const map = {};
  for (const gate of GATES) {
    if (!gate.artifacts) continue;
    for (const it of gate.items) {
      const prefix = it.kind.toLowerCase() + "_";
      map[it.id] = names.some((n) => n.startsWith(prefix) && !DEPON_RAW.test(n));
    }
  }
  return map;
}

// Возвращает трекер с рассчитанной готовностью. Сливает ручные статусы (store)
// с авто-статусами G3 (из отчёта проверок) и GD (из артефактов депонирования).
function buildTracker(id) {
  const manual = store.getTracker(id) || {};
  const report = store.getReport(id);
  const auto = autoStateFromReport(report);
  const artAuto = autoStateFromArtifacts(id);

  let doneTotal = 0, itemsTotal = 0;
  const gates = GATES.map((g) => {
    const items = g.items.map((it) => {
      const done = g.auto ? !!auto[it.id] : g.artifacts ? !!artAuto[it.id] : !!manual[it.id];
      itemsTotal++; if (done) doneTotal++;
      return { ...it, done };
    });
    const done = items.filter((i) => i.done).length;
    return {
      id: g.id, title: g.title, auto: !!g.auto, artifacts: !!g.artifacts, link: g.link || null,
      items, done, total: items.length,
      complete: done === items.length,
      percent: items.length ? Math.round((done / items.length) * 100) : 0,
    };
  });

  return {
    productId: id,
    gates,
    percent: itemsTotal ? Math.round((doneTotal / itemsTotal) * 100) : 0,
    done: doneTotal, total: itemsTotal,
    hasReport: !!report,
    checksOverall: report ? report.overall : null,
  };
}

// Обновляет ручные статусы (auto-гейты игнорируются). patch: { itemId: bool }.
function updateManual(id, patch) {
  const manual = store.getTracker(id) || {};
  const autoIds = new Set(GATES.filter((g) => g.auto || g.artifacts).flatMap((g) => g.items.map((i) => i.id)));
  for (const [k, v] of Object.entries(patch || {})) {
    if (autoIds.has(k)) continue; // авто-пункты (проверки/артефакты) не редактируются вручную
    manual[k] = !!v;
  }
  store.saveTracker(id, manual);
  return buildTracker(id);
}

module.exports = { GATES, buildTracker, updateManual, autoStateFromReport, autoStateFromArtifacts };
