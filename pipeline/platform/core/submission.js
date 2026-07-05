"use strict";
// Сборка «монтажного листа подачи»: готовые значения полей карточки ПО для
// портала reestr.digital.gov.ru, перечень вложений и пошаговый сценарий.
// Данные берутся из карточки продукта, отчёта проверок, списков артефактов и досье.

const store = require("./store");
const tracker = require("./tracker");
const { cardCompleteness } = require("./readiness");

function val(x, dash = "—") { return (x === undefined || x === null || x === "") ? dash : x; }
function joinList(a) { return Array.isArray(a) ? a.join(", ") : val(a); }

// Абзац «Сведения о соответствии ПП № 1236» — текстом для вставки на портал.
// Логика согласована с docCompliance в ../../03_docs/dossier.js.
function complianceText(p) {
  const rh = p.rightholder || {}, f = p.finance || {}, s = p.support || {}, t = p.tech || {}, pr = p.product || {};
  const pct = (f.annualRevenueProduct > 0)
    ? ((f.annualForeignPayments / f.annualRevenueProduct) * 100).toFixed(2) + "%"
    : "—";
  const lines = [
    `Правообладатель — российское лицо ${val(rh.orgName)} (ИНН ${val(rh.inn)}); суммарная доля РФ-контроля ${val(rh.ruControlSharePercent)}% (> 50%).`,
    `Исключительное право на ПО принадлежит правообладателю (${p.rights && p.rights.basis === "rospatent" ? "свидетельство Роспатента" : "служебные произведения / договоры"}).`,
    `Доля выплат иностранным правообладателям — ${pct} выручки по продукту (требование: строго < 30%).`,
    `Сопровождение и техподдержка осуществляются на территории РФ ${s.hasForeignControl === false ? "без иностранного контроля" : "(уточнить отсутствие иностранного контроля)"}.`,
    `Продукт не управляется и не обновляется принудительно из-за пределов РФ; инфраструктура размещена ${t.infraLocation === "RU" ? "в РФ" : "(уточнить локацию)"}.`,
    `Графический интерфейс — на русском языке${pr.guiLanguage === "ru" ? "" : " (уточнить)"}.`,
  ];
  return lines.join(" ");
}

function buildSubmission(id) {
  const p = store.getProduct(id);
  const pr = p.product || {}, rh = p.rightholder || {};
  const isSaaS = String(pr.deliveryType).toUpperCase() === "SAAS";

  const fields = [
    { portalLabel: "Наименование ПО", value: val(pr.name) },
    { portalLabel: "Класс(ы) ПО (по классификатору)", value: joinList(pr.class), note: "СВЕРИТЬ код класса" },
    { portalLabel: "Модель поставки", value: val(pr.deliveryType) },
    { portalLabel: "Правообладатель", value: val(rh.orgName) },
    { portalLabel: "ИНН", value: val(rh.inn) },
    { portalLabel: "ОГРН", value: val(rh.ogrn) },
    { portalLabel: "Адрес правообладателя", value: val(rh.address) },
    { portalLabel: "Адрес страницы продукта в сети", value: val(pr.productPageUrl) },
    { portalLabel: "Описание функциональных характеристик", value: val(pr.description) },
    { portalLabel: "Назначение / область применения", value: val(pr.purpose) },
    { portalLabel: "Сведения о соответствии ПП № 1236", value: complianceText(p) },
  ];
  if (isSaaS && pr.expertDemo) {
    const d = pr.expertDemo;
    fields.push({ portalLabel: "Доступ эксперта к экземпляру (демо)",
      value: `URL: ${val(d.url)}; логин: ${val(d.login)}; пароль: ${val(d.password)}` });
  }

  // Вложения — что приложить к заявлению, с флагом наличия в платформе.
  const dossier = store.listDossier(id);
  const artifacts = store.listArtifacts(id);
  const report = store.getReport(id);
  const hasArtifact = (hint) => artifacts.some((a) => a.name.toLowerCase().includes(hint));

  const attachments = [
    (() => {
      const has = hasArtifact("rights") || hasArtifact("rospatent") || hasArtifact("dep_cert") || hasArtifact("dep_chain");
      return { label: "Правоустанавливающие документы (Роспатент / служебные произведения)",
        ready: has, manual: !has, note: has ? "загружено в разделе «Депонирование»" : null };
    })(),
    { label: "Выписка ЕГРЮЛ и структура владения", ready: false, manual: true },
    { label: "Бухгалтерская справка о выплатах иностранцам < 30%",
      ready: dossier.some((d) => d.name.includes("Справка")),
      file: dossier.find((d) => d.name.includes("Справка")) },
    { label: "Опись пакета документов",
      ready: dossier.some((d) => d.name.includes("Опись")),
      file: dossier.find((d) => d.name.includes("Опись")) },
    { label: "Архитектурная записка",
      ready: dossier.some((d) => d.name.includes("Архитектурная")),
      file: dossier.find((d) => d.name.includes("Архитектурная")) },
    { label: "Сведения о соответствии ПП № 1236 (документ)",
      ready: dossier.some((d) => d.name.includes("Соответствие")),
      file: dossier.find((d) => d.name.includes("Соответствие")) },
    { label: "SBOM (состав ПО, CycloneDX)", ready: hasArtifact("sbom") || hasArtifact("cyclonedx") || hasArtifact("bom") },
    { label: "Отчёт технической готовности", ready: !!report, note: report ? `итог: ${report.overall}` : "не запускались" },
    { label: "Техдокументация: руководства пользователя/администратора", ready: false, manual: true },
  ].map((a) => ({ ...a, downloadName: a.file ? a.file.name : null }));

  const steps = [
    "Войти на reestr.digital.gov.ru через ЕСИА под учётной записью организации.",
    "Создать заявление на включение сведений о ПО в реестр.",
    "Заполнить карточку ПО значениями из таблицы выше (копировать по полям).",
    "Приложить документы из списка вложений (СВЕРИТЬ требуемые форматы на портале).",
    "Указать сведения о соответствии требованиям ПП № 1236.",
    "Для SaaS — указать данные доступа эксперта к демо-экземпляру.",
    "Подписать заявление УКЭП.",
    "Нажать «Отправить документы на проверку».",
  ];

  const t = tracker.buildTracker(id);
  const completeness = cardCompleteness(p);
  const nextActions = buildNextActions(id, p, completeness, t, artifacts, report);

  return {
    productId: id,
    productName: pr.name || id,
    fields,
    attachments,
    steps,
    completeness,
    nextActions,
    readiness: { percent: t.percent, checksOverall: t.checksOverall },
  };
}

// Единый список «что осталось за человеком»: незаполненные поля карточки,
// отсутствующие артефакты и невыполненные ручные пункты трекера (авто-G3 —
// не действие человека, исключаем). kind → к какой вкладке ведёт действие.
function buildNextActions(id, product, completeness, t, artifacts, report) {
  const actions = [];

  completeness.missing.forEach((m) => {
    actions.push({ kind: "card", area: m.section, text: `Заполнить: ${m.label}`, hash: `#/p/${id}` });
  });

  const hasArtifact = (hint) => artifacts.some((a) => a.name.toLowerCase().includes(hint));
  if (!hasArtifact("sbom") && !hasArtifact("cyclonedx") && !hasArtifact("bom"))
    actions.push({ kind: "artifact", area: "Проверки", text: "Загрузить SBOM (состав ПО)", hash: `#/p/${id}` });
  if (!hasArtifact(".har") && !hasArtifact("network"))
    actions.push({ kind: "artifact", area: "Проверки", text: "Снять и загрузить HAR (сетевой трафик)", hash: `#/p/${id}` });
  if (!report)
    actions.push({ kind: "checks", area: "Проверки", text: "Запустить технические проверки", hash: `#/p/${id}/checks` });

  // Невыполненные пункты трекера (без авто-G3). Гейт GD (депонирование) ведёт
  // на «Документы», где эти пункты закрываются загрузкой/генерацией файлов.
  t.gates.filter((g) => !g.auto).forEach((g) => {
    const hash = g.link ? `#/p/${id}${g.link}` : `#/p/${id}/tracker`;
    g.items.filter((it) => !it.done).forEach((it) => {
      actions.push({ kind: g.artifacts ? "artifact" : "tracker", area: `${g.id} ${g.title}`, text: it.text, hash });
    });
  });

  return actions;
}

module.exports = { buildSubmission, complianceText };
