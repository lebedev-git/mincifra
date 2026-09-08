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

// Возвращает до `limit` кандидатов { code, name, score, trustedOsSince },
// отсортированных по числу совпавших ключевых слов (score > 0 — иначе класс не
// попадает в список). trustedOsSince — дата, с которой к классу применяется
// требование двух доверенных ОС (ПП № 1236 п. 5 подп. «м»).
function suggestClasses(text, limit = 3) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return [];
  const { classes } = loadClasses();

  const scored = classes
    .map((c) => {
      const score = (c.keywords || []).reduce((n, kw) => n + (t.includes(kw.toLowerCase()) ? 1 : 0), 0);
      return { code: c.code, name: c.name, trustedOsSince: c.trustedOsSince || null, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

// С какой даты к продукту применяется требование о двух доверенных ОС.
// codes — массив вида product.class (["04.09", "06.03", ...]); сверяем по префиксу
// верхнеуровневого кода (первые 2 цифры), т.к. справочник хранит только их.
// Если класс попадает в несколько волн, действует САМАЯ РАННЯЯ дата.
// null — класс в волнах акта не упомянут (напр. встроенное ПО).
function trustedOsSince(codes) {
  if (!Array.isArray(codes) || !codes.length) return null;
  const { classes } = loadClasses();
  const byCode = new Map(classes.map((c) => [c.code, c.trustedOsSince || null]));
  const dates = codes
    .map((code) => byCode.get(String(code).slice(0, 2)))
    .filter(Boolean)
    .sort();
  return dates[0] || null;
}

module.exports = { suggestClasses, trustedOsSince, loadClasses };
