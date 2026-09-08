"use strict";
// Валидация реквизитов правообладателя (офлайн, по контрольным суммам).
// Ловит опечатки в ИНН/ОГРН и неверные даты ДО подачи на портал, где они
// всплыли бы поздно. Пустые поля дают SKIP (карточка на ранней стадии неполна),
// некорректные — FAIL, спорные — WARN. В авто-гейт G3 не входит (это про G0/G1).

// --- Контрольная сумма ИНН юрлица (10 цифр). Алгоритм ФНС. ---
function innLegalValid(inn) {
  if (!/^\d{10}$/.test(inn)) return false;
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  let s = 0;
  for (let i = 0; i < 9; i++) s += w[i] * Number(inn[i]);
  const ctrl = (s % 11) % 10;
  return ctrl === Number(inn[9]);
}

// --- Контрольная сумма ИНН физлица/ИП/самозанятого (12 цифр). Два контрольных разряда. ---
function innPersonValid(inn) {
  if (!/^\d{12}$/.test(inn)) return false;
  const w11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const w12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  let s1 = 0;
  for (let i = 0; i < 10; i++) s1 += w11[i] * Number(inn[i]);
  if ((s1 % 11) % 10 !== Number(inn[10])) return false;
  let s2 = 0;
  for (let i = 0; i < 11; i++) s2 += w12[i] * Number(inn[i]);
  return (s2 % 11) % 10 === Number(inn[11]);
}

// --- ИНН правообладателя: юрлицо (10) ИЛИ физлицо/ИП (12). ---
function innValid(inn) {
  return /^\d{12}$/.test(inn) ? innPersonValid(inn) : innLegalValid(inn);
}

// --- Контрольная сумма ОГРН юрлица (13 цифр): первые 12 как число mod 11, mod 10 == 13-я. ---
function ogrnValid(ogrn) {
  if (!/^\d{13}$/.test(ogrn)) return false;
  const head = ogrn.slice(0, 12);
  // head может превышать Number.MAX_SAFE_INTEGER — считаем остаток по цифрам.
  let rem = 0;
  for (const ch of head) rem = (rem * 10 + Number(ch)) % 11;
  const ctrl = (rem % 10);
  return ctrl === Number(ogrn[12]);
}

// --- Контрольная сумма ОГРНИП (15 цифр): первые 14 как число mod 13, mod 10 == 15-я. ---
function ogrnipValid(ogrnip) {
  if (!/^\d{15}$/.test(ogrnip)) return false;
  const head = ogrnip.slice(0, 14);
  let rem = 0;
  for (const ch of head) rem = (rem * 10 + Number(ch)) % 13;
  const ctrl = (rem % 10);
  return ctrl === Number(ogrnip[14]);
}

// --- ОГРН правообладателя: юрлицо (13) ИЛИ ИП (15). ---
function ogrnAnyValid(v) {
  return /^\d{15}$/.test(v) ? ogrnipValid(v) : ogrnValid(v);
}

// --- Дата в формате ГГГГ-ММ-ДД и реально существующая. ---
function isoDateValid(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function run(product) {
  const id = "requisites";
  const title = "Реквизиты правообладателя (ИНН/ОГРН/даты — контрольные суммы)";
  const rh = (product && product.rightholder) || {};
  const rights = (product && product.rights) || {};
  const findings = [];

  // ИНН
  const inn = rh.inn != null ? String(rh.inn).trim() : "";
  if (!inn) {
    findings.push({ severity: "SKIP", field: "rightholder.inn", note: "не заполнен" });
  } else if (!innValid(inn)) {
    findings.push({ severity: "FAIL", field: "rightholder.inn",
      note: /^\d{10}$|^\d{12}$/.test(inn)
        ? "неверная контрольная цифра ИНН"
        : "ИНН должен содержать 10 цифр (юрлицо) или 12 цифр (физлицо/ИП)" });
  }

  // Правообладателем по ПП № 1236 п. 5 подп. «а» может быть и гражданин РФ.
  // У него нет ни ОГРН, ни доли участия — эти поля к нему просто не относятся.
  const isCitizen = String(rh.holderType || "") === "citizen";

  // ОГРН
  const ogrn = rh.ogrn != null ? String(rh.ogrn).trim() : "";
  if (isCitizen && !ogrn) {
    // ничего: у физлица ОГРН нет
  } else if (!ogrn) {
    findings.push({ severity: "SKIP", field: "rightholder.ogrn", note: "не заполнен" });
  } else if (!ogrnAnyValid(ogrn)) {
    findings.push({ severity: "FAIL", field: "rightholder.ogrn",
      note: /^\d{13}$|^\d{15}$/.test(ogrn)
        ? "неверная контрольная цифра ОГРН/ОГРНИП"
        : "ОГРН — 13 цифр (юрлицо) или ОГРНИП — 15 цифр (ИП)" });
  }

  // Гражданство — для правообладателя-физлица это и есть критерий подп. «а».
  if (isCitizen && String(rh.citizenship || "").toUpperCase() !== "RU") {
    findings.push({ severity: "FAIL", field: "rightholder.citizenship",
      note: "правообладатель-физлицо должен быть гражданином РФ (п. 5 подп. «а»)" });
  }
  if (isCitizen && !/^\d{12}$/.test(inn)) {
    findings.push({ severity: "WARN", field: "rightholder.inn",
      note: "у физлица ИНН — 12 цифр (п. 4 подп. «е»: ИНН обязателен для гражданина РФ)" });
  }

  // Доля РФ-контроля
  const share = rh.ruControlSharePercent;
  if (isCitizen) {
    // ничего: доля участия применима только к организации
  } else if (share == null || share === "") {
    findings.push({ severity: "SKIP", field: "rightholder.ruControlSharePercent", note: "не заполнена" });
  } else {
    const v = Number(share);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      findings.push({ severity: "FAIL", field: "rightholder.ruControlSharePercent", note: "должна быть 0–100%" });
    } else if (v <= 50) {
      findings.push({ severity: "FAIL", field: "rightholder.ruControlSharePercent",
        note: `${v}% — требуется строго > 50% (стоп-фактор)` });
    }
  }

  // Дата свидетельства Роспатента (если основание — rospatent)
  const certDate = rights.rospatentCertificateDate;
  if (certDate) {
    if (!isoDateValid(String(certDate))) {
      findings.push({ severity: "WARN", field: "rights.rospatentCertificateDate",
        note: "дата не в формате ГГГГ-ММ-ДД или не существует" });
    }
  }

  const hasFail = findings.some((f) => f.severity === "FAIL");
  const hasWarn = findings.some((f) => f.severity === "WARN");
  // Если заполнено хоть что-то валидное — итог PASS/WARN/FAIL; если всё пусто — SKIP.
  const allSkip = findings.length > 0 && findings.every((f) => f.severity === "SKIP");
  const status = hasFail ? "FAIL" : hasWarn ? "WARN" : allSkip ? "SKIP" : "PASS";

  const summary = hasFail
    ? "Есть ошибки в реквизитах — исправить до подачи (контрольные суммы/пороги не сходятся)."
    : hasWarn
    ? "Реквизиты заполнены с замечаниями — проверить формат."
    : allSkip
    ? "Реквизиты правообладателя ещё не заполнены."
    : "Реквизиты правообладателя корректны (контрольные суммы сходятся).";

  return { id, title, status, summary, findings };
}

module.exports = {
  run, innLegalValid, innPersonValid, innValid,
  ogrnValid, ogrnipValid, ogrnAnyValid, isoDateValid,
};
