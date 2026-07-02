"use strict";
// Проверка карточки/страницы продукта по декларативным полям product.json.
// Живой fetch страницы не выполняется (российские сайты часто недоступны из
// окружения CI/эксперта за периметром) — проверяются заявленные атрибуты и
// перекрёстные условия. Фактическую доступность в инкогнито подтверждает
// человек по чек-листу G2; сетевую локализацию — network_audit по HAR.

function run(product) {
  const id = "page_check";
  const title = "Страница продукта и локализация (декларативная проверка)";
  const p = (product && product.product) || {};
  const s = (product && product.support) || {};
  const findings = [];

  const url = p.productPageUrl;
  if (!url) {
    findings.push({ severity: "FAIL", field: "product.productPageUrl", note: "не указан публичный URL страницы продукта" });
  } else if (!/^https?:\/\//i.test(url)) {
    findings.push({ severity: "FAIL", field: "product.productPageUrl", note: "URL должен быть абсолютным (http/https)" });
  }

  if (p.guiLanguage && String(p.guiLanguage).toLowerCase() !== "ru") {
    findings.push({ severity: "FAIL", field: "product.guiLanguage",
      note: "GUI обязан быть на русском языке (стоп-фактор Экспертного совета)" });
  } else if (!p.guiLanguage) {
    findings.push({ severity: "WARN", field: "product.guiLanguage", note: "не указан язык интерфейса" });
  }

  if (!s.contactsRu) {
    findings.push({ severity: "WARN", field: "support.contactsRu", note: "не указаны контакты техподдержки в РФ" });
  }
  if (!s.lifecycleDocUrl) {
    findings.push({ severity: "WARN", field: "support.lifecycleDocUrl",
      note: "нет ссылки на описание процессов жизненного цикла/техподдержки" });
  }
  if (s.hasForeignControl === true) {
    findings.push({ severity: "FAIL", field: "support.hasForeignControl",
      note: "техподдержку ведёт лицо с иностранным контролем — стоп-фактор" });
  }

  // SaaS: обязателен демо-доступ для эксперта.
  if (String(p.deliveryType).toUpperCase() === "SAAS") {
    const demo = p.expertDemo || {};
    if (!demo.url) {
      findings.push({ severity: "FAIL", field: "product.expertDemo.url",
        note: "для SaaS обязателен демо-стенд с доступом для эксперта" });
    }
  }

  const hasFail = findings.some((f) => f.severity === "FAIL");
  const hasWarn = findings.some((f) => f.severity === "WARN");
  const status = hasFail ? "FAIL" : hasWarn ? "WARN" : "PASS";
  const summary = hasFail
    ? "Есть блокеры в описании страницы/локализации продукта."
    : hasWarn
    ? "Заполнено с замечаниями — дополнить перед подачей."
    : "Декларативные атрибуты страницы продукта в норме (живую доступность подтвердить вручную, G2).";

  return { id, title, status, summary, findings };
}

module.exports = { run };
