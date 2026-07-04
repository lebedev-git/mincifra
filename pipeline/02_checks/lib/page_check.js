"use strict";
// Проверка карточки/страницы продукта по декларативным полям product.json.
// По умолчанию живой fetch страницы не выполняется (российские сайты часто
// недоступны из окружения CI/эксперта за периметром) — проверяются заявленные
// атрибуты и перекрёстные условия. Фактическую доступность в инкогнито
// подтверждает человек по чек-листу G2; сетевую локализацию — network_audit по HAR.
//
// runLive — ОПЦИОНАЛЬНОЕ дополнение: реальный HTTP-запрос к productPageUrl из
// этого окружения. Строго по запросу (opts.live в checks.js) — инструмент
// по умолчанию не должен сам обращаться в сеть. Результат живой проверки не
// заменяет ручной чек-лист G2 (доступность в инкогнито, вёрстка), а лишь
// снимает часть его пунктов автоматически, когда сеть до страницы есть.

const http = require("http");
const https = require("https");
const { isAllowed, matchForeign } = require("./network_audit");

const LIVE_TIMEOUT_MS = 10000;
const LIVE_MAX_REDIRECTS = 5;

// Один HTTP GET с ручным следованием редиректам (без внешних зависимостей).
function fetchOnce(urlStr, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (_) { reject(new Error("некорректный URL")); return; }
    if (u.protocol !== "http:" && u.protocol !== "https:") { reject(new Error("нужен http(s) URL")); return; }
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.get(u, { timeout: LIVE_TIMEOUT_MS, headers: { "User-Agent": "mincifra-registry-check/1.0" } }, (res) => {
      const { statusCode, headers } = res;
      res.resume(); // тело не нужно — важны только статус и заголовки
      if (statusCode >= 300 && statusCode < 400 && headers.location && redirectsLeft > 0) {
        let next;
        try { next = new URL(headers.location, u).toString(); }
        catch (_) { resolve({ statusCode, headers, finalUrl: u.toString() }); return; }
        resolve(fetchOnce(next, redirectsLeft - 1));
        return;
      }
      resolve({ statusCode, headers, finalUrl: u.toString() });
    });
    req.on("timeout", () => req.destroy(new Error("таймаут запроса")));
    req.on("error", reject);
  });
}

// Живая проверка: код ответа, финальный хост после редиректов, Content-Language.
async function runLive(product) {
  const id = "page_check_live";
  const title = "Живая проверка страницы продукта (реальный HTTP-запрос)";
  const url = product && product.product && product.product.productPageUrl;
  const findings = [];

  if (!url) return { id, title, status: "SKIP", summary: "Не указан product.productPageUrl.", findings };

  let res;
  try {
    res = await fetchOnce(url, LIVE_MAX_REDIRECTS);
  } catch (e) {
    findings.push({ severity: "WARN", field: "product.productPageUrl",
      note: `Страница недоступна из окружения проверки: ${e.message}. Возможно, доступ ограничен только из РФ — сверьте вручную (G2).` });
    return { id, title, status: "WARN", summary: "Не удалось выполнить живой запрос — сверьте доступность вручную.", findings };
  }

  let host = "";
  try { host = new URL(res.finalUrl).hostname.toLowerCase(); } catch (_) { /* не должно случиться */ }

  if (host && !isAllowed(host)) {
    const m = matchForeign(host);
    if (m) findings.push({ severity: "FAIL", field: "product.productPageUrl",
      note: `Страница отдаётся с зарубежного хоста: ${host} (${m.kind} — ${m.tag}).` });
    else findings.push({ severity: "WARN", field: "product.productPageUrl",
      note: `Финальный хост после редиректов — ${host}, не входит в список РФ/нейтральных хостов. Проверьте хостинг вручную.` });
  }

  if (res.statusCode >= 400) {
    findings.push({ severity: "FAIL", field: "product.productPageUrl", note: `Страница вернула код ${res.statusCode}.` });
  } else if (res.statusCode >= 300) {
    findings.push({ severity: "WARN", field: "product.productPageUrl",
      note: `Не удалось разрешить редирект за ${LIVE_MAX_REDIRECTS} шагов — цепочка подозрительно длинная.` });
  }

  const lang = String((res.headers && res.headers["content-language"]) || "").toLowerCase();
  if (lang && !lang.startsWith("ru")) {
    findings.push({ severity: "WARN", field: "product.productPageUrl",
      note: `Заголовок Content-Language «${lang}» — не «ru». Заголовок не всегда отражает реальный язык GUI — сверьте вручную.` });
  }

  const hasFail = findings.some((f) => f.severity === "FAIL");
  const hasWarn = findings.some((f) => f.severity === "WARN");
  const status = hasFail ? "FAIL" : hasWarn ? "WARN" : "PASS";
  const summary = hasFail
    ? `Живая проверка нашла блокеры (код ${res.statusCode}${host ? `, хост ${host}` : ""}).`
    : hasWarn
    ? `Страница отвечает (код ${res.statusCode}${host ? `, хост ${host}` : ""}), есть замечания — сверить вручную.`
    : `Страница отвечает (код ${res.statusCode}), финальный хост ${host} — в списке РФ/нейтральных.`;

  return { id, title, status, summary, findings };
}

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

module.exports = { run, runLive };
