"use strict";
// Справочники для технических проверок готовности к реестру российского ПО.
// Источник требований — аналитическая записка проекта (Блок 2) и стоп-факторы
// Экспертного совета. Списки не исчерпывающие — дополняйте под свой стек.

// --- Сетевой аудит: домены зарубежной инфраструктуры ---------------------
// Совпадение по суффиксу хоста (endsWith). Обязательные обращения к ним в
// рантайме продукта — стоп-фактор («call home» за пределы РФ).
const FOREIGN_DOMAINS = [
  // CDN шрифтов/скриптов/стилей
  { host: "fonts.googleapis.com", kind: "CDN шрифтов", tag: "Google Fonts" },
  { host: "fonts.gstatic.com", kind: "CDN шрифтов", tag: "Google Fonts" },
  { host: "cdnjs.cloudflare.com", kind: "CDN скриптов", tag: "cdnjs" },
  { host: "cdn.jsdelivr.net", kind: "CDN скриптов", tag: "jsDelivr" },
  { host: "unpkg.com", kind: "CDN скриптов", tag: "unpkg" },
  { host: "ajax.googleapis.com", kind: "CDN скриптов", tag: "Google CDN" },
  { host: "stackpath.bootstrapcdn.com", kind: "CDN стилей", tag: "BootstrapCDN" },
  { host: "use.fontawesome.com", kind: "CDN иконок", tag: "Font Awesome" },
  // Аналитика / телеметрия
  { host: "google-analytics.com", kind: "Аналитика", tag: "Google Analytics" },
  { host: "googletagmanager.com", kind: "Аналитика", tag: "Google Tag Manager" },
  { host: "www.googletagmanager.com", kind: "Аналитика", tag: "Google Tag Manager" },
  { host: "hotjar.com", kind: "Аналитика", tag: "Hotjar" },
  { host: "static.hotjar.com", kind: "Аналитика", tag: "Hotjar" },
  { host: "sentry.io", kind: "Телеметрия ошибок", tag: "Sentry (облако)" },
  { host: "ingest.sentry.io", kind: "Телеметрия ошибок", tag: "Sentry (облако)" },
  { host: "connect.facebook.net", kind: "Трекинг", tag: "Facebook Pixel" },
  { host: "amplitude.com", kind: "Аналитика", tag: "Amplitude" },
  { host: "mixpanel.com", kind: "Аналитика", tag: "Mixpanel" },
  { host: "segment.io", kind: "Аналитика", tag: "Segment" },
  // Облачная инфраструктура / registries
  { host: "amazonaws.com", kind: "Облако/хостинг", tag: "AWS" },
  { host: "azure.com", kind: "Облако/хостинг", tag: "Azure" },
  { host: "blob.core.windows.net", kind: "Облако/хостинг", tag: "Azure Blob" },
  { host: "googleapis.com", kind: "Облако/API", tag: "Google APIs" },
  { host: "gstatic.com", kind: "Статика", tag: "Google Static" },
  { host: "cloudflare.com", kind: "Облако/CDN", tag: "Cloudflare" },
  { host: "docker.io", kind: "Реестр образов", tag: "Docker Hub" },
  { host: "ghcr.io", kind: "Реестр образов", tag: "GitHub CR" },
  { host: "registry.npmjs.org", kind: "Реестр пакетов", tag: "npm" },
  // VCS / карты / платежи (иностранные)
  { host: "gitlab.com", kind: "VCS", tag: "GitLab.com" },
  { host: "github.com", kind: "VCS", tag: "GitHub" },
  { host: "raw.githubusercontent.com", kind: "VCS-статика", tag: "GitHub Raw" },
  { host: "maps.googleapis.com", kind: "Карты", tag: "Google Maps" },
  { host: "api.stripe.com", kind: "Платежи", tag: "Stripe" },
];

// Российские/нейтральные хосты, которые НЕ считаем стоп-фактором.
// Помогает снизить ложные срабатывания при широких суффиксах (напр. *.ru).
const ALLOWED_SUFFIXES = [
  ".ru", ".рф", ".su",
  "mc.yandex.ru", "yandex.ru", "yandex.net",
  "vk.com", "vk.ru",
  "storage.yandexcloud.net", "yandexcloud.net",
  "selcdn.ru", "selectel.ru",
  "sbercloud.ru", "cloud.ru",
  "localhost", "127.0.0.1",
];

// --- Аудит лицензий OSS ---------------------------------------------------
// Категории риска по аналитической записке (Блок 2.3).
// Ключи лицензий сверяются по SPDX-идентификаторам (регистр игнорируется).
const LICENSE_RISK = {
  // Критический — исключить полностью.
  critical: {
    label: "Критический",
    action: "Исключить полностью",
    spdx: ["SSPL-1.0", "BUSL-1.1", "BSL-1.0-NC", "CC-BY-NC-4.0", "CC-BY-NC-SA-4.0"],
    // Особые маркеры (не SPDX) обрабатываются отдельно в license_scan.
    markers: ["NOASSERTION", "UNLICENSED", "NONE", "SEE LICENSE IN"],
  },
  // Высокий — strong copyleft, «заражает» проприетарный продукт.
  high: {
    label: "Высокий (strong copyleft)",
    action: "Убрать из ядра проприетарного продукта; AGPL критична для SaaS",
    spdx: ["GPL-2.0-only", "GPL-2.0-or-later", "GPL-3.0-only", "GPL-3.0-or-later",
           "AGPL-3.0-only", "AGPL-3.0-or-later", "GPL-2.0", "GPL-3.0", "AGPL-3.0"],
  },
  // Средний — weak copyleft, допустимо при изоляции/динамической линковке.
  medium: {
    label: "Средний (weak copyleft)",
    action: "Допустимо при динамической линковке/изоляции; статическая линковка в ядро — риск",
    spdx: ["LGPL-2.1-only", "LGPL-2.1-or-later", "LGPL-3.0-only", "LGPL-3.0-or-later",
           "MPL-2.0", "EPL-1.0", "EPL-2.0", "LGPL-2.1", "LGPL-3.0"],
  },
  // Низкий — permissive, допустимо с атрибуцией.
  low: {
    label: "Низкий (permissive)",
    action: "Допустимо. Соблюдать атрибуцию (NOTICE); для Apache-2.0 учесть патентную оговорку",
    spdx: ["MIT", "BSD-2-Clause", "BSD-3-Clause", "APACHE-2.0", "ISC", "ZLIB",
           "0BSD", "UNLICENSE", "CC0-1.0", "PYTHON-2.0", "WTFPL"],
  },
};

// Порог правила 30% (финансовый критерий ПП № 1236).
const FOREIGN_PAYMENTS_THRESHOLD = 0.30;

module.exports = {
  FOREIGN_DOMAINS,
  ALLOWED_SUFFIXES,
  LICENSE_RISK,
  FOREIGN_PAYMENTS_THRESHOLD,
};
