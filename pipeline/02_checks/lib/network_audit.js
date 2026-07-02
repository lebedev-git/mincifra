"use strict";
// Сетевой аудит: ищет в исходящем трафике продукта обязательные обращения к
// зарубежной инфраструктуре (CDN, аналитика, облака, registries).
// Вход: HAR-файл (DevTools → Network → Save all as HAR) или JSON со списком
// URL/доменов: { "urls": [...] } либо { "domains": [...] }.

const fs = require("fs");
const path = require("path");
const { FOREIGN_DOMAINS, ALLOWED_SUFFIXES } = require("./rules");

function hostFromUrl(u) {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch (_) {
    // строка уже может быть голым хостом
    return String(u).toLowerCase().replace(/^\*?\.?/, "");
  }
}

function isAllowed(host) {
  return ALLOWED_SUFFIXES.some((s) => host === s || host.endsWith(s));
}

function matchForeign(host) {
  return FOREIGN_DOMAINS.find((d) => host === d.host || host.endsWith("." + d.host) || host.endsWith(d.host));
}

// Достаёт список хостов из HAR или упрощённого JSON.
function extractHosts(raw, filePath) {
  const hosts = new Set();
  if (raw && raw.log && Array.isArray(raw.log.entries)) {
    // HAR
    for (const e of raw.log.entries) {
      const u = e && e.request && e.request.url;
      if (u) hosts.add(hostFromUrl(u));
    }
    return { hosts: [...hosts], source: "HAR", ok: true };
  }
  if (raw && Array.isArray(raw.urls)) {
    raw.urls.forEach((u) => hosts.add(hostFromUrl(u)));
    return { hosts: [...hosts], source: "urls[]", ok: true };
  }
  if (raw && Array.isArray(raw.domains)) {
    raw.domains.forEach((d) => hosts.add(hostFromUrl(d)));
    return { hosts: [...hosts], source: "domains[]", ok: true };
  }
  return { hosts: [], source: `неизвестный формат (${path.basename(filePath)})`, ok: false };
}

function run(product, baseDir) {
  const id = "network_audit";
  const title = "Сетевой аудит исходящего трафика (нет обращений за рубеж)";
  const rel = product && product.tech && product.tech.networkEvidenceFile;

  if (!rel) {
    return { id, title, status: "SKIP",
      summary: "Не указан tech.networkEvidenceFile — приложите HAR рабочего экземпляра.", findings: [] };
  }
  const file = path.resolve(baseDir, rel);
  if (!fs.existsSync(file)) {
    return { id, title, status: "SKIP",
      summary: `Файл не найден: ${rel}`, findings: [] };
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { id, title, status: "FAIL",
      summary: `Не удалось разобрать файл ${rel}: ${e.message}`, findings: [] };
  }

  const { hosts, source, ok } = extractHosts(raw, file);
  if (!ok) {
    return { id, title, status: "FAIL",
      summary: `Не распознан формат данных (${source}). Ожидается HAR или {urls:[...]} / {domains:[...]}.`, findings: [] };
  }

  const findings = [];
  for (const h of hosts) {
    if (isAllowed(h)) continue;
    const m = matchForeign(h);
    if (m) findings.push({ severity: "FAIL", host: h, note: `${m.kind} — ${m.tag}` });
  }

  // Хосты вне белого списка и вне известных зарубежных — под ручную проверку.
  const unknown = hosts.filter((h) => !isAllowed(h) && !matchForeign(h));
  unknown.forEach((h) => findings.push({ severity: "WARN", host: h, note: "неизвестный внешний хост — проверить юрисдикцию вручную" }));

  const hasFail = findings.some((f) => f.severity === "FAIL");
  const hasWarn = findings.some((f) => f.severity === "WARN");
  const status = hasFail ? "FAIL" : hasWarn ? "WARN" : "PASS";
  const summary = hasFail
    ? `Обнаружены обязательные обращения к зарубежной инфраструктуре (источник: ${source}, хостов всего: ${hosts.length}).`
    : hasWarn
    ? `Зарубежных стоп-хостов не найдено, но есть внешние хосты под ручную проверку (${source}).`
    : `Обращений к зарубежной инфраструктуре не обнаружено (${source}, хостов: ${hosts.length}).`;

  return { id, title, status, summary, findings };
}

module.exports = { run };
