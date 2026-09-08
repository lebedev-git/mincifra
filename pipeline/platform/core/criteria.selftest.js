"use strict";
// Селф-тест движка соответствия ПП № 1236: node platform/core/criteria.selftest.js
// Ловит четыре класса поломок: потерянный пункт справочника, ложное «соответствует»
// на пустой карточке, неверный расчёт даты вступления требования по классу ПО и
// подмену «не заявлено» на «заявлено отсутствие».

const assert = require("assert");
const { evaluate, reference } = require("./criteria");

const ref = reference();

// 1. Целостность справочника: у каждого пункта есть норма и исполнимое правило.
for (const list of [ref.requirements, ref.attachments]) {
  for (const it of list) {
    assert.ok(it.norm, `пункт без ссылки на норму: ${JSON.stringify(it).slice(0, 60)}`);
    assert.ok(it.text, `пункт ${it.norm} без дословного текста нормы`);
    assert.ok(it.test && it.test.kind, `пункт ${it.norm} без правила проверки`);
  }
}
for (const f of ref.recordFields) assert.ok(f.norm && f.text, "поле реестровой записи без нормы или текста");

// 2. Пустая карточка не должна давать ни одного выполненного требования.
const empty = evaluate({}, null, [], "2026-09-08");
assert.strictEqual(empty.requirements.filter((r) => r.status === "ok").length, 0,
  "на пустой карточке нашлось выполненное требование");
assert.strictEqual(empty.canDeclareCompliance, false,
  "пустая карточка не может декларировать соответствие пункту 5");

// 3. «Не заявлено» — это не «заявлено отсутствие».
// Подп. «г» (гостайна) закрывается только явным false, а не отсутствием поля.
const secretUnset = empty.requirements.find((r) => r.norm.includes("«г»"));
assert.strictEqual(secretUnset.status, "no", "отсутствие поля зачлось как отсутствие гостайны");

// 4. Дата вступления подп. «м» считается по классу продукта.
// Офисное ПО (класс 06) — волна 01.09.2026, уже в силе на 08.09.2026.
const office = evaluate({ product: { class: ["06.03"] } }, null, [], "2026-09-08");
const officeM = office.requirements.find((r) => r.norm.includes("«м»"));
assert.strictEqual(officeM.status, "no", "для класса 06 требование двух доверенных ОС должно действовать");
// Прикладное ПО (класс 05) — волна 01.06.2027, ещё не наступила.
const applied = evaluate({ product: { class: ["05.01"] } }, null, [], "2026-09-08");
const appliedM = applied.requirements.find((r) => r.norm.includes("«м»"));
assert.strictEqual(appliedM.status, "pending", "для класса 05 требование ещё не должно действовать");
assert.ok(appliedM.reason.includes("2027-06-01"), "не та дата волны для класса 05");

// 5. Полностью соответствующая карточка закрывает все действующие требования.
const good = {
  product: {
    name: "Тест", class: ["05.01"], guiLanguage: "ru", okpd2: "62.01.29",
    productPageUrl: "https://example.ru/p", pricingUrl: "https://example.ru/price",
    expertDemo: { url: "https://demo.example.ru" },
  },
  rightholder: { holderType: "org", orgName: "ООО Тест", inn: "7701234567", ruControlSharePercent: 100, stateControlled: false },
  rights: { basis: "rospatent" },
  finance: { annualRevenueProduct: 1000000, annualForeignPayments: 0 },
  tech: { cicdLocation: "RU", licenseKeysLocation: "RU" },
  support: { contactsRu: "+7 000", hasForeignControl: false },
  compliance: {
    freelyDistributedRu: true, containsStateSecret: false,
    forcedForeignUpdate: false, isInfoProtectionSoftware: false,
  },
};
const report = { results: [{ id: "foreign_payments", status: "PASS" }, { id: "network_audit", status: "PASS" }] };
const ok = evaluate(good, report, [], "2026-09-08");
const stillOpen = ok.requirements.filter((r) => r.status === "no");
assert.deepStrictEqual(stillOpen.map((r) => r.norm), [],
  "остались незакрытые требования: " + stillOpen.map((r) => r.norm).join(", "));
assert.strictEqual(ok.canDeclareCompliance, true, "заполненная карточка должна позволять декларацию");

// 6. Правообладателем может быть гражданин РФ — это шестой абзац подп. «а».
// Отчуждение права в ООО для реестра не обязательно; устав тогда не требуется.
const citizen = evaluate(
  { ...good, rightholder: { holderType: "citizen", citizenFullName: "Иванов Иван Иванович", inn: "770112345678", citizenship: "RU" } },
  report, [], "2026-09-08");
assert.strictEqual(citizen.requirements.find((r) => r.norm.includes("«а»")).status, "ok",
  "гражданин РФ должен проходить подп. «а» пункта 5");
assert.strictEqual(citizen.attachments.find((a) => a.norm.includes("«в»")).status, "n/a",
  "устав не требуется, если правообладатель — гражданин РФ");
// Без указания типа правообладателя пункт не закрывается — молча «сойдёт» быть не должно.
const noType = evaluate({ ...good, rightholder: { orgName: "ООО Тест", inn: "7701234567", ruControlSharePercent: 100 } },
  report, [], "2026-09-08");
assert.strictEqual(noType.requirements.find((r) => r.norm.includes("«а»")).status, "no",
  "без rightholder.holderType подп. «а» не должен закрываться");

// 7. Неприменимые пункты помечаются, а не считаются проваленными.
const infosecOff = ok.requirements.filter((r) => r.status === "n/a").map((r) => r.norm);
assert.ok(infosecOff.some((n) => n.includes("«д»")), "подп. «д» должен быть неприменим для не-СЗИ");

console.log(`OK: справочник ${ref.act.approvedBy} (${ref.act.edition}) — ` +
  `${ref.requirements.length} требований, ${ref.attachments.length} приложений, ` +
  `${ref.recordFields.length} полей записи; движок сходится`);
