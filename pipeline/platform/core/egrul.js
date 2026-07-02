"use strict";
// Автозаполнение реквизитов по ИНН через DaData (единственная сетевая функция).
// Изолировано: сеть включается ТОЛЬКО при заданном env DADATA_TOKEN. Без ключа
// платформа остаётся полностью офлайн (isEnabled() === false, кнопка в UI скрыта).
// Ключ не передаётся в браузер — запрос делает сервер.

const TOKEN = process.env.DADATA_TOKEN || "";
const ENDPOINT = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party";
const TIMEOUT_MS = 8000;

function isEnabled() { return !!TOKEN; }

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

// Возвращает { orgName, ogrn, inn, address, status } либо бросает httpError.
async function lookupByInn(innRaw) {
  if (!isEnabled()) throw httpError(503, "Автозаполнение по ИНН выключено: не задан DADATA_TOKEN.");
  const inn = String(innRaw || "").trim();
  if (!/^\d{10}$|^\d{12}$/.test(inn)) throw httpError(400, "ИНН должен содержать 10 (юрлицо) или 12 (ИП) цифр.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Token ${TOKEN}`,
      },
      body: JSON.stringify({ query: inn }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw httpError(504, e.name === "AbortError" ? "Таймаут запроса к DaData." : `Сеть недоступна: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Пробрасываем сообщение DaData — оно указывает точную причину
    // (например: функция «Подсказки»/SUGGESTIONS не включена для ключа).
    let detail = "";
    try { const j = await res.json(); detail = j && (j.message || j.reason) ? ` — ${j.message || j.reason}` : ""; }
    catch (_) { /* тело не JSON */ }
    if (res.status === 401 || res.status === 403)
      throw httpError(502, `DaData отклонила запрос (проверьте ключ и что включена функция «Подсказки»)${detail}`);
    if (res.status === 429)
      throw httpError(502, `Превышен лимит запросов к DaData — повторите позже${detail}`);
    throw httpError(502, `DaData вернула ошибку ${res.status}${detail}`);
  }

  let data;
  try { data = await res.json(); }
  catch (_) { throw httpError(502, "Некорректный ответ DaData."); }

  const s = data && Array.isArray(data.suggestions) ? data.suggestions[0] : null;
  if (!s || !s.data) throw httpError(404, `Организация с ИНН ${inn} не найдена.`);

  const d = s.data;
  const name = (d.name && (d.name.short_with_opf || d.name.full_with_opf)) || s.value || "";
  return {
    inn: d.inn || inn,
    ogrn: d.ogrn || "",
    orgName: name,
    address: (d.address && d.address.value) || "",
    status: (d.state && d.state.status) || "",
  };
}

module.exports = { isEnabled, lookupByInn };
