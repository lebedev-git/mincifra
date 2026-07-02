"use strict";
// Pre-flight полноты карточки: какие обязательные поля ещё не заполнены.
// Не дублирует технические проверки (02_checks) — отвечает на вопрос «что человеку
// осталось ввести», а не «сойдутся ли критерии». Используется экраном «Что осталось».

// Обязательные поля карточки: [путь, человекочитаемая подпись, раздел].
const REQUIRED = [
  ["product.name", "Наименование ПО", "Продукт"],
  ["product.class", "Класс(ы) ПО", "Продукт"],
  ["product.deliveryType", "Модель поставки", "Продукт"],
  ["product.productPageUrl", "URL страницы продукта", "Продукт"],
  ["product.description", "Описание функциональных характеристик", "Продукт"],
  ["rightholder.orgName", "Правообладатель", "Правообладатель"],
  ["rightholder.inn", "ИНН", "Правообладатель"],
  ["rightholder.ogrn", "ОГРН", "Правообладатель"],
  ["rightholder.ruControlSharePercent", "Доля РФ-контроля, %", "Правообладатель"],
  ["finance.annualRevenueProduct", "Выручка по продукту за год", "Финансы"],
  ["finance.annualForeignPayments", "Выплаты иностранцам за год", "Финансы"],
];

function getVal(obj, pathStr) {
  return pathStr.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
function isEmpty(v) {
  if (v == null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

// Список незаполненных обязательных полей, сгруппированный по разделам.
function cardCompleteness(product) {
  const missing = [];
  for (const [pathStr, label, section] of REQUIRED) {
    if (isEmpty(getVal(product, pathStr))) missing.push({ path: pathStr, label, section });
  }
  const total = REQUIRED.length;
  const filled = total - missing.length;
  return {
    total,
    filled,
    percent: Math.round((filled / total) * 100),
    complete: missing.length === 0,
    missing,
  };
}

module.exports = { cardCompleteness, REQUIRED };
