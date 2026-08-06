"use strict";
// Самопроверка реферата по п. 30 Правил (приказ Минэкономразвития № 211):
//   node core/rospatent.selftest.js
// Реферат обязан завершаться языком программирования и объёмом в байтах, а его
// длина не должна превышать 900 знаков — даже если описание в карточке огромное.
// Сети и БД не требует: buildReferat работает с переданным объектом карточки.

const assert = require("assert");
const { buildReferat, REFERAT_LIMIT } = require("./rospatent");

const base = {
  product: {
    name: "Тестовая программа",
    description: "Описание функциональных возможностей.",
    purpose: "Учёт заявок.",
    programmingLanguages: ["JavaScript"],
  },
  tech: { supportedOS: ["Astra Linux"] },
  registration: { deviceType: "Персональный компьютер / сервер" },
};

const r = buildReferat(base, 4284785);
assert.ok(r.includes("Язык программирования: JavaScript."), "нет языка программирования");
assert.ok(r.endsWith("Объём программы: 4284785 байт."), "реферат не завершается объёмом в байтах");
assert.ok(r.length <= REFERAT_LIMIT, `превышен лимит: ${r.length}`);

// Обязательный хвост не должен срезаться при обрезке длинного описания.
const long = JSON.parse(JSON.stringify(base));
long.product.description = "Очень длинное описание. ".repeat(200);
const r2 = buildReferat(long, 123);
assert.ok(r2.length <= REFERAT_LIMIT, `превышен лимит при обрезке: ${r2.length}`);
assert.ok(r2.endsWith("Объём программы: 123 байт."), "хвост срезан вместе с описанием");

// Персональные данные: если обрабатываются — указание в реферате обязательно.
const pdn = JSON.parse(JSON.stringify(base));
pdn.personalData = { contains: true, operatorRegNumber: "77-24-000123" };
const r3 = buildReferat(pdn, 1);
assert.ok(r3.includes("Содержит персональные данные"), "ПДн не отражены в реферате");
assert.ok(r3.includes("77-24-000123"), "нет номера в реестре операторов ПДн");

// Объём неизвестен (снимок не сделан) — реферат не должен врать про байты.
assert.ok(buildReferat(base, null).includes("Объём программы: не определён."), "объём подставлен неверно");

console.log(`OK: реферат соответствует п. 30 (${r.length} из ${REFERAT_LIMIT} знаков)`);
