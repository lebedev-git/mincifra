"use strict";
// Движок соответствия ПП РФ № 1236. Требования, состав заявления и приложения
// не зашиты в код — они лежат выпиской в ../../99_reference/pp1236.json, где у
// каждого пункта есть дословный текст нормы и декларативное правило проверки.
// Здесь только вычислитель этих правил. Добавить критерий = добавить запись в
// справочник; код не трогается. Так чек-лист сверяется с актом построчно и
// одинаково работает на любом продукте.
//
// Статус пункта:
//   ok      — правило выполнено
//   no      — правило не выполнено (в карточке нет данных или значение не то)
//   n/a     — пункт неприменим к этому продукту (appliesIf ложно)
//   pending — норма ещё не вступила в силу для этого продукта (since в будущем)

const fs = require("fs");
const path = require("path");

const REF_PATH = path.resolve(__dirname, "../../99_reference/pp1236.json");
let _ref = null;
function reference() {
  if (!_ref) _ref = JSON.parse(fs.readFileSync(REF_PATH, "utf8"));
  return _ref;
}

function get(obj, pathStr) {
  if (!pathStr) return undefined;
  return String(pathStr).split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
function toNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function notEmpty(v) {
  if (v == null || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

// --- Вычисление одного правила -------------------------------------------
// ctx = { product, reportById, artifactNames }
function evalRule(rule, ctx) {
  if (!rule) return false;
  switch (rule.kind) {
    case "all":
      return (rule.of || []).every((r) => evalRule(r, ctx));
    case "any":
      return (rule.of || []).some((r) => evalRule(r, ctx));
    case "notEmpty":
      return notEmpty(get(ctx.product, rule.path));
    case "isTrue":
      return get(ctx.product, rule.path) === true;
    case "isFalse":
      // Строго false. undefined — это «не заявлено», а не «нет».
      return get(ctx.product, rule.path) === false;
    case "equals":
      return String(get(ctx.product, rule.path) || "") === String(rule.value);
    case "numGt": {
      const n = toNum(get(ctx.product, rule.path));
      return n !== null && n > rule.value;
    }
    case "minItems": {
      const v = get(ctx.product, rule.path);
      return Array.isArray(v) && v.length >= rule.value;
    }
    case "ratioLte": {
      const den = toNum(get(ctx.product, rule.den));
      const num = toNum(get(ctx.product, rule.num));
      if (den === null || den <= 0 || num === null) return false;
      return num / den <= rule.value;
    }
    case "checkPass":
      return ctx.reportById[rule.id] === "PASS";
    case "artifact": {
      const prefix = String(rule.prefix).toLowerCase() + "_";
      return ctx.artifactNames.some((n) => n.startsWith(prefix));
    }
    default:
      return false;
  }
}

// --- Дата вступления требования в силу ------------------------------------
// Для подп. «м» (совместимость с доверенными ОС) дата зависит от класса ПО:
// акт вводит требование волнами по категориям. Берём САМУЮ РАННЮЮ волну среди
// классов продукта — если продукт в нескольких категориях, действует ближайшая.
function effectiveSince(item, product) {
  if (!item.sinceByClassWave) return item.since || null;
  const codes = (get(product, "product.class") || []).map((c) => String(c).slice(0, 2));
  const waves = reference().trustedOsWaves
    .filter((w) => w.classes.some((c) => codes.includes(c)))
    .map((w) => w.date)
    .sort();
  // Класс не сопоставлен ни одной волне — требование к продукту пока не отнесено.
  return waves[0] || null;
}

function inForce(since, today) {
  if (!since) return false;
  return since <= today;
}

// --- Оценка списка пунктов справочника ------------------------------------
function evalItems(items, ctx, today) {
  return items.map((it) => {
    const since = effectiveSince(it, ctx.product);
    const base = {
      id: it.id || it.norm,
      norm: it.norm,
      title: it.title || it.text,
      text: it.text,
      note: it.note || null,
      evidence: it.evidence || [],
      since,
    };
    if (it.appliesIf && !evalRule(it.appliesIf, ctx)) {
      return { ...base, status: "n/a", reason: "пункт неприменим к этому продукту" };
    }
    // Требование с датой в будущем показываем, но не считаем незакрытым.
    if (since && !inForce(since, today)) {
      return { ...base, status: "pending", reason: `вступает в силу ${since}` };
    }
    if (it.sinceByClassWave && !since) {
      return { ...base, status: "pending", reason: "класс продукта не сопоставлен волне — сверить на портале" };
    }
    return { ...base, status: evalRule(it.test, ctx) ? "ok" : "no" };
  });
}

// Обязательные поля реестровой записи (п. 4) — те, что заполняет заявитель.
function evalRecordFields(ctx, today) {
  return reference().recordFields
    .filter((f) => f.path)
    .map((f) => {
      const since = f.since || null;
      const base = { id: f.norm, norm: f.norm, title: f.text, text: f.text, note: f.note || null, evidence: [], since };
      if (since && !inForce(since, today)) return { ...base, status: "pending", reason: `вступает в силу ${since}` };
      // У поля может быть либо простой путь, либо правило — когда значение лежит
      // в разных местах карточки в зависимости от типа правообладателя.
      const filled = f.test ? evalRule(f.test, ctx) : notEmpty(get(ctx.product, f.path));
      if (!filled && f.optional) return { ...base, status: "n/a", reason: "сведения указываются при наличии" };
      return { ...base, status: filled ? "ok" : "no" };
    });
}

function buildContext(product, report, artifactNames) {
  const reportById = {};
  ((report && report.results) || []).forEach((r) => { reportById[r.id] = r.status; });
  return {
    product: product || {},
    reportById,
    artifactNames: (artifactNames || []).map((n) => String(n).toLowerCase()),
  };
}

// Полная сверка продукта с актом.
// today — ISO-дата (YYYY-MM-DD), по умолчанию сегодняшняя; параметр нужен тестам.
function evaluate(product, report, artifactNames, today) {
  const day = today || new Date().toISOString().slice(0, 10);
  const ctx = buildContext(product, report, artifactNames);
  const ref = reference();
  const requirements = evalItems(ref.requirements, ctx, day);
  const attachments = evalItems(ref.attachments, ctx, day);
  const recordFields = evalRecordFields(ctx, day);

  const count = (list) => ({
    ok: list.filter((x) => x.status === "ok").length,
    no: list.filter((x) => x.status === "no").length,
    na: list.filter((x) => x.status === "n/a").length,
    pending: list.filter((x) => x.status === "pending").length,
  });

  const blocking = requirements.filter((x) => x.status === "no");
  return {
    act: ref.act,
    evaluatedAt: day,
    requirements,
    attachments,
    recordFields,
    totals: {
      requirements: count(requirements),
      attachments: count(attachments),
      recordFields: count(recordFields),
    },
    // Соответствие пункту 5 — то, что заявитель декларирует по п. 10 подп. «г».
    // Декларировать можно только когда ни одно действующее требование не открыто.
    canDeclareCompliance: blocking.length === 0,
    blocking: blocking.map((x) => ({ norm: x.norm, title: x.title })),
  };
}

module.exports = { evaluate, evalRule, effectiveSince, reference, REF_PATH };
