"use strict";
// Правило 30%: финансовый критерий ПП № 1236.
// Годовые выплаты иностранным правообладателям за права на ПО и его компоненты
// должны быть СТРОГО МЕНЬШЕ 30% выручки правообладателя от реализации продукта.

const { FOREIGN_PAYMENTS_THRESHOLD } = require("./rules");

function fmt(n) {
  return new Intl.NumberFormat("ru-RU").format(n);
}

function run(product) {
  const id = "foreign_payments";
  const title = "Правило 30% (выплаты иностранцам < 30% выручки по продукту)";
  const f = (product && product.finance) || {};
  const revenue = Number(f.annualRevenueProduct);
  const foreign = Number(f.annualForeignPayments);
  const cur = f.currency || "RUB";

  if (!Number.isFinite(revenue) || revenue <= 0) {
    return { id, title, status: "SKIP",
      summary: "Не задана finance.annualRevenueProduct (> 0).", findings: [] };
  }
  if (!Number.isFinite(foreign) || foreign < 0) {
    return { id, title, status: "SKIP",
      summary: "Не задана finance.annualForeignPayments (>= 0).", findings: [] };
  }

  const ratio = foreign / revenue;
  const pct = (ratio * 100).toFixed(2);
  const thr = FOREIGN_PAYMENTS_THRESHOLD * 100;
  const pass = ratio < FOREIGN_PAYMENTS_THRESHOLD;

  const findings = [{
    severity: pass ? "PASS" : "FAIL",
    metric: `${fmt(foreign)} / ${fmt(revenue)} ${cur} = ${pct}%`,
    note: `Порог: строго < ${thr}%`,
  }];

  // Пограничная зона — предупреждение, чтобы не подавать «впритык».
  const status = !pass ? "FAIL" : ratio >= 0.25 ? "WARN" : "PASS";
  if (status === "WARN") {
    findings.push({ severity: "WARN", metric: `${pct}%`,
      note: "Доля близка к порогу (>= 25%). Заложить запас и подтвердить бухгалтерски." });
  }

  const summary = pass
    ? `Доля выплат иностранцам ${pct}% < ${thr}% — критерий выполнен.`
    : `Доля выплат иностранцам ${pct}% >= ${thr}% — критерий НЕ выполнен (стоп-фактор).`;

  return { id, title, status, summary, findings };
}

module.exports = { run };
