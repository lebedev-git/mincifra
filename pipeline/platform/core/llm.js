"use strict";
// Опциональное улучшение автозаполнения через LLM (Anthropic Claude API).
// Изолировано и OPT-IN: включается ТОЛЬКО при заданном env ANTHROPIC_API_KEY.
// Без ключа платформа остаётся полностью офлайн (isEnabled() === false), а свободный
// текст пользователя используется как есть. Ключ живёт только на сервере, в браузер
// не передаётся — по тому же принципу, что и DaData (core/egrul.js).

const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 30000;

function isEnabled() { return !!API_KEY; }
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

// Просит модель вернуть аккуратные формулировки полей карточки на основе фактов о
// репозитории и свободного текста пользователя. Возвращает объект с полями-черновиками
// (description, purpose, guiLanguage, classHint) либо бросает httpError.
// Модель НЕ придумывает реквизиты/финансы — только текстовые характеристики продукта.
async function draftCardText({ facts, notes }) {
  if (!isEnabled()) throw httpError(503, "LLM-улучшение выключено: не задан ANTHROPIC_API_KEY.");

  const system =
    "Ты помогаешь заполнить карточку продукта для Единого реестра российского ПО (Минцифры). " +
    "На вход — факты о репозитории и заметки правообладателя. Верни СТРОГО JSON без пояснений " +
    "с полями: description (функциональные характеристики, 2–4 предложения, по-русски), " +
    "purpose (назначение, 1–2 предложения), guiLanguage ('ru'|'en'|''), " +
    "classHint (короткая подсказка о вероятном классе ПО по ПП №1236, без выдумывания кода). " +
    "Не выдумывай факты, которых нет во входных данных. Если данных мало — пиши обобщённо и коротко.";

  const user = JSON.stringify({ facts: facts || {}, notes: String(notes || "") });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw httpError(504, e.name === "AbortError" ? "Таймаут запроса к LLM." : `Сеть недоступна: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = "";
    try { const j = await res.json(); detail = j && j.error && j.error.message ? ` — ${j.error.message}` : ""; }
    catch (_) { /* тело не JSON */ }
    if (res.status === 401 || res.status === 403) throw httpError(502, `LLM отклонил ключ${detail}`);
    if (res.status === 429) throw httpError(502, `Превышен лимит запросов к LLM${detail}`);
    throw httpError(502, `LLM вернул ошибку ${res.status}${detail}`);
  }

  let data;
  try { data = await res.json(); }
  catch (_) { throw httpError(502, "Некорректный ответ LLM."); }

  const text = data && Array.isArray(data.content)
    ? data.content.map((b) => (b && b.text) || "").join("").trim()
    : "";
  return parseModelJson(text);
}

// Аккуратно достаёт JSON из ответа (модель могла обернуть его в ```json ... ```).
function parseModelJson(text) {
  let s = String(text || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  else { const a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a >= 0 && b > a) s = s.slice(a, b + 1); }
  try {
    const o = JSON.parse(s);
    return {
      description: str(o.description),
      purpose: str(o.purpose),
      guiLanguage: ["ru", "en", ""].includes(o.guiLanguage) ? o.guiLanguage : "",
      classHint: str(o.classHint),
    };
  } catch (_) {
    throw httpError(502, "LLM вернул неразборчивый ответ (не JSON).");
  }
}
function str(v) { return v == null ? "" : String(v).trim(); }

module.exports = { isEnabled, draftCardText };
