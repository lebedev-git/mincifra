"use strict";
// Подсказка класса ПО по тексту описания/назначения продукта.
// Детерминированное совпадение ключевых слов из 99_reference/software_classes.json
// (никакого LLM/сети — офлайн, как и остальные проверки ядра). Результат — ЧЕРНОВИК:
// человек выбирает и сверяет точный подкласс на reestr.digital.gov.ru перед подачей,
// автоподсказка только сужает 12 верхнеуровневых классов до 2-3 кандидатов.

const fs = require("fs");
const path = require("path");

const CLASSES_PATH = path.resolve(__dirname, "../../99_reference/software_classes.json");
let _cache = null;

function loadClasses() {
  if (_cache) return _cache;
  _cache = JSON.parse(fs.readFileSync(CLASSES_PATH, "utf8"));
  return _cache;
}

// Возвращает до `limit` кандидатов { code, name, score, pp325 }, отсортированных
// по числу совпавших ключевых слов (score > 0 — иначе класс не попадает в список).
function suggestClasses(text, limit = 3) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return [];
  const { classes } = loadClasses();

  const scored = classes
    .map((c) => {
      const score = (c.keywords || []).reduce((n, kw) => n + (t.includes(kw.toLowerCase()) ? 1 : 0), 0);
      return { code: c.code, name: c.name, pp325: !!c.pp325, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

// Применимы ли доптребования ПП №325 хотя бы к одному из выбранных кодов класса.
// codes — массив вида product.class (["04", "06.03", ...]); сверяем по префиксу
// верхнеуровневого кода (первые 2 цифры), т.к. справочник хранит только их.
function pp325AppliesTo(codes) {
  if (!Array.isArray(codes) || !codes.length) return false;
  const { classes } = loadClasses();
  const flagged = new Set(classes.filter((c) => c.pp325).map((c) => c.code));
  return codes.some((code) => flagged.has(String(code).slice(0, 2)));
}

module.exports = { suggestClasses, pp325AppliesTo, loadClasses };
