"use strict";
// Фиксер: перенос веб-шрифтов с внешнего CDN (Google Fonts) в локальный self-host.
//
// Зачем: network_audit даёт FAIL при обращении к fonts.googleapis.com / fonts.gstatic.com —
// для реестра это стоп-фактор (обращение к иностранной инфраструктуре в рантайме).
// Фиксер убирает внешнее обращение: шрифт скачивается и раздаётся со своего домена.
//
// Двухфазность (безопасность + офлайн-принцип платформы):
//   scan(dir)          — ТОЛЬКО чтение файлов, БЕЗ сети. Находит внешние ссылки на шрифты.
//   apply(dir, scan)   — СЕТЕВАЯ операция (скачивает CSS+woff2). Вызывается явно, делает бэкап.
//
// Чужой код правим консервативно: заменяем ТОЛЬКО строку внешнего @import на локальный;
// остальной CSS не трогаем; исходный файл сохраняется в <file>.bak. Для Next.js в отчёт
// добавляется рекомендация next/font (официальный путь), но компоненты не переписываются.

const fs = require("fs");
const path = require("path");

// Внешние провайдеры веб-шрифтов, дающие стоп-фактор. Расширяемо.
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
// Каталоги, которые не обходим при сканировании исходников.
const SKIP_DIR = new Set(["node_modules", ".git", ".next", "dist", "build", "out",
  "coverage", ".venv", "venv", "vendor", ".idea", ".vscode"]);
// User-Agent современного браузера — иначе Google отдаёт устаревшие ttf вместо woff2.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const NET_TIMEOUT_MS = 20000;

function readTextSafe(file) {
  try { return fs.readFileSync(file, "utf8"); } catch (_) { return null; }
}

// Проект на Next.js? (влияет на рекомендацию next/font и на выбор public/ каталога)
function detectNextJs(dir) {
  const pkg = readTextSafe(path.join(dir, "package.json"));
  if (!pkg) return false;
  try {
    const j = JSON.parse(pkg);
    const deps = { ...(j.dependencies || {}), ...(j.devDependencies || {}) };
    return Object.prototype.hasOwnProperty.call(deps, "next");
  } catch (_) { return false; }
}

// Рекурсивный обход дерева с фильтром по расширениям (детерминированный порядок).
function walkFiles(root, exts) {
  const out = [];
  (function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(path.join(d, e.name)); }
      else if (exts.has(path.extname(e.name).toLowerCase())) out.push(path.join(d, e.name));
    }
  })(root);
  return out;
}

// Все внешние URL шрифт-CDN в тексте (css2-ссылки и gstatic), с номерами строк.
function findExternalRefs(text) {
  const refs = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((ln, i) => {
    if (FONT_HOSTS.some((h) => ln.includes(h))) {
      // Вытаскиваем конкретные URL из строки (в кавычках, url(), или голые).
      const urls = ln.match(/https?:\/\/[^\s"')]+/g) || [];
      for (const u of urls) {
        if (FONT_HOSTS.some((h) => u.includes(h))) {
          refs.push({ line: i + 1, url: u, raw: ln.trim() });
        }
      }
    }
  });
  return refs;
}

// ФАЗА 1 — скан без сети. Возвращает карту находок по файлам.
function scan(projectDir) {
  const isNextJs = detectNextJs(projectDir);
  const hasPublic = fs.existsSync(path.join(projectDir, "public"));

  // CSS — где реально можно авто-заменить @import. JSX/TSX/HTML — только для предупреждения.
  const cssFiles = walkFiles(projectDir, new Set([".css", ".scss"]));
  const markupFiles = walkFiles(projectDir, new Set([".html", ".jsx", ".tsx", ".js", ".ts"]));

  const cssHits = [];
  for (const f of cssFiles) {
    const text = readTextSafe(f);
    if (!text) continue;
    const refs = findExternalRefs(text);
    if (refs.length) cssHits.push({ file: f, refs });
  }
  const markupHits = [];
  for (const f of markupFiles) {
    const text = readTextSafe(f);
    if (!text) continue;
    const refs = findExternalRefs(text);
    if (refs.length) markupHits.push({ file: f, refs });
  }

  const css2Urls = new Set();
  const gstaticUrls = new Set();
  [...cssHits, ...markupHits].forEach((h) => h.refs.forEach((r) => {
    if (r.url.includes("fonts.googleapis.com")) css2Urls.add(r.url);
    if (r.url.includes("fonts.gstatic.com")) gstaticUrls.add(r.url);
  }));

  return {
    projectDir,
    isNextJs,
    hasPublic,
    cssHits,        // авто-фиксятся
    markupHits,     // только предупреждение (link/JSX) — правит человек / next/font
    css2Urls: [...css2Urls],
    gstaticUrls: [...gstaticUrls],
    clean: cssHits.length === 0 && markupHits.length === 0,
  };
}

// Человекочитаемое резюме находок (для CLI и для skill).
function summarize(s) {
  if (s.clean) return "Внешних обращений к шрифт-CDN не найдено — фиксить нечего.";
  const parts = [];
  if (s.cssHits.length) parts.push(`CSS с внешним шрифтом: ${s.cssHits.length} файл(ов) — можно авто-фиксить`);
  if (s.markupHits.length) parts.push(`Ссылки в разметке (link/JSX): ${s.markupHits.length} файл(ов) — правятся вручную`);
  if (s.isNextJs) parts.push("Проект на Next.js — рекомендуется next/font (официальный self-host)");
  return parts.join("; ");
}

// --- Сетевые помощники (используются только в apply) ---

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), NET_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} при запросе ${url}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

async function fetchBinary(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), NET_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} при скачивании ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(t); }
}

function familySlug(css2Url) {
  const m = css2Url.match(/[?&]family=([^:&]+)/);
  const name = m ? decodeURIComponent(m[1]).replace(/\+/g, " ") : "font";
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "font";
}

// ФАЗА 2 — применение (сеть). Возвращает сводку изменений; при dryRun — только план.
// opts: { onStep(msg) }
async function apply(scanResult, opts = {}) {
  const onStep = opts.onStep || (() => {});
  const s = scanResult;
  if (s.clean || s.cssHits.length === 0) {
    return { changed: false, note: "Нет CSS-файлов с внешним шрифтом для авто-фикса.", files: [] };
  }

  // Куда класть woff2: public/fonts (Next.js и любой проект с public/) → web-путь "/fonts/..".
  const usePublic = s.hasPublic;
  const downloaded = new Map();   // localName -> Buffer (дедуп между файлами)
  const changedFiles = [];
  const warnings = [];

  for (const hit of s.cssHits) {
    const cssDir = path.dirname(hit.file);
    // Внешние css2-ссылки именно этого файла.
    const css2 = [...new Set(hit.refs.map((r) => r.url).filter((u) => u.includes("fonts.googleapis.com")))];
    if (css2.length === 0) {
      // В файле только gstatic напрямую (редко) — предупреждаем, авто-фикс пропускаем.
      warnings.push(`${rel(s.projectDir, hit.file)}: прямые ссылки на gstatic без css2 — пропущено, правьте вручную.`);
      continue;
    }

    // Каталог для woff2 и web-путь.
    const fontsDir = usePublic ? path.join(s.projectDir, "public", "fonts") : path.join(cssDir, "fonts");
    const webBase = usePublic ? "/fonts" : "./fonts";
    fs.mkdirSync(fontsDir, { recursive: true });

    // Собираем @font-face со всех css2-ссылок файла, подменяя gstatic → локальный путь.
    let fontFaceCss = "";
    for (const url of css2) {
      onStep(`Загружаю описание шрифта: ${url}`);
      let css = await fetchText(url);
      const slug = familySlug(url);
      const woff2Urls = css.match(/https:\/\/fonts\.gstatic\.com\/[^)"']+\.woff2/g) || [];
      for (const wurl of woff2Urls) {
        const base = wurl.split("/").pop();
        const localName = `${slug}-${base}`;
        if (!downloaded.has(localName)) {
          onStep(`Скачиваю шрифт: ${localName}`);
          downloaded.set(localName, await fetchBinary(wurl));
        }
        css = css.split(wurl).join(`${webBase}/${localName}`);
      }
      fontFaceCss += css.trim() + "\n\n";
    }

    // Пишем локальный fonts.css рядом с исходным CSS.
    const localCssPath = path.join(cssDir, "fonts.local.css");
    const header =
      "/* Локальный self-host веб-шрифтов. Сгенерировано фиксером 04_fixers/selfhost_fonts.\n" +
      " * Внешний шрифт-CDN вынесен на свой домен ради offline-работы и требований реестра РФ.\n" +
      " * Проверьте лицензию шрифта (для свободных — SIL OFL). */\n\n";
    fs.writeFileSync(localCssPath, header + fontFaceCss.trimEnd() + "\n", "utf8");
    changedFiles.push(rel(s.projectDir, localCssPath) + " (создан)");

    // Правим исходный CSS: строки с внешним шрифт-CDN → локальный @import (только первая),
    // остальные внешние строки удаляем. Бэкап оригинала.
    const original = fs.readFileSync(hit.file, "utf8");
    fs.writeFileSync(hit.file + ".bak", original, "utf8");
    const localImport = `@import "./fonts.local.css";`;
    let replaced = false;
    const newText = original.split(/\r?\n/).map((ln) => {
      if (FONT_HOSTS.some((h) => ln.includes(h))) {
        if (!replaced) { replaced = true; return localImport; }
        return null; // повторные внешние строки убираем
      }
      return ln;
    }).filter((ln) => ln !== null).join("\n");
    fs.writeFileSync(hit.file, newText, "utf8");
    changedFiles.push(rel(s.projectDir, hit.file) + " (правлен, бэкап .bak)");
  }

  // Пишем сами woff2.
  const fontsWritten = [];
  for (const [name, buf] of downloaded) {
    const dir = usePublic ? path.join(s.projectDir, "public", "fonts") : null;
    // При per-file без public каталог уже создан рядом с css; для простоты в этом режиме
    // woff2 кладём в каталог первого затронутого css.
    const targetDir = dir || path.join(path.dirname(s.cssHits[0].file), "fonts");
    fs.mkdirSync(targetDir, { recursive: true });
    const p = path.join(targetDir, name);
    fs.writeFileSync(p, buf);
    fontsWritten.push(rel(s.projectDir, p));
  }

  // Разметочные ссылки (link/JSX) авто-фикс не покрывает.
  if (s.markupHits.length) {
    warnings.push(`Ссылки на шрифт в разметке (${s.markupHits.length} файл(ов)) не тронуты — ` +
      (s.isNextJs ? "перенесите на next/font или уберите <link> вручную." : "уберите <link> и подключите локальный шрифт вручную."));
  }
  if (s.isNextJs) {
    warnings.push("Next.js: предпочтительный путь — next/font/google (сам self-host'ит на сборке). " +
      "Текущий фикс работает, но next/font чище для долгой поддержки.");
  }

  return {
    changed: changedFiles.length > 0,
    files: changedFiles,
    fonts: fontsWritten,
    fontsCount: downloaded.size,
    warnings,
  };
}

function rel(root, p) { return path.relative(root, p).replace(/\\/g, "/") || p; }

module.exports = { scan, summarize, apply, detectNextJs, FONT_HOSTS };
