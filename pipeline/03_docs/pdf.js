"use strict";
// Прямая генерация итоговых PDF для подачи в Роспатент (ст. 1262 ГК): реферат и
// фрагмент исходного кода. Шрифт — Liberation Serif (метрически совместим с Times
// New Roman, с кириллицей); код — Liberation Mono. Шрифты забандлены в ./fonts, поэтому
// PDF одинаков локально и на сервере, без завязки на системные шрифты.
//
// Зависимость pdfkit — опциональная (как docx): ищется лениво, понятная ошибка если нет.
// buildReferatPdf / buildCodeFragmentPdf возвращают Buffer.

const fs = require("fs");
const path = require("path");

const FONTS_DIR = path.join(__dirname, "fonts");
const SERIF = path.join(FONTS_DIR, "LiberationSerif-Regular.ttf");
const SERIF_BOLD = path.join(FONTS_DIR, "LiberationSerif-Bold.ttf");
const MONO = path.join(FONTS_DIR, "LiberationMono-Regular.ttf");

function requirePdfkit() {
  try { return require("pdfkit"); }
  catch (_) {
    throw new Error("Не найден модуль «pdfkit». Установите: npm install pdfkit (в каталоге платформы).");
  }
}

function asList(v) { return Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]); }

// Собирает поток PDFKit в Buffer.
function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function newDoc(PDFDocument) {
  // bufferPages: true — иначе switchToPage/нумерация плодят лишнюю страницу.
  const doc = new PDFDocument({ size: "A4", bufferPages: true, margins: { top: 72, bottom: 64, left: 72, right: 64 } });
  doc.registerFont("serif", SERIF);
  doc.registerFont("serif-bold", SERIF_BOLD);
  doc.registerFont("mono", MONO);
  return doc;
}

// Нумерация страниц снизу по центру (как «footer» в docx).
function addPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Печать ниже нижнего поля добавила бы новую страницу — временно снимаем поле.
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("serif").fontSize(10).fillColor("#000")
      .text(String(i + 1), 0, doc.page.height - 40, { align: "center", width: doc.page.width, lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }
  doc.flushPages();
}

// ---------- Реферат программы для ЭВМ ----------
async function buildReferatPdf(product) {
  const PDFDocument = requirePdfkit();
  const p = (product && product.product) || {}, t = (product && product.tech) || {};
  const langs = asList(p.programmingLanguages);
  const doc = newDoc(PDFDocument);

  doc.font("serif-bold").fontSize(16).text("РЕФЕРАТ", { align: "center" });
  doc.moveDown(0.3);
  doc.font("serif-bold").fontSize(13).text(p.name || "____", { align: "center" });
  doc.moveDown(1);

  const label = (t1, v) => {
    doc.font("serif-bold").fontSize(12).text(t1, { continued: true });
    doc.font("serif").text(v);
  };
  doc.font("serif").fontSize(12).text(p.description || "— описание функциональных характеристик —", { align: "justify" });
  doc.moveDown(0.6);
  label("Назначение: ", p.purpose || "— область применения —");
  doc.moveDown(0.3);
  label("Язык программирования: ", (langs.length ? langs.join(", ") : "— указать —") + ".");
  doc.moveDown(0.3);
  label("Операционные системы: ", (asList(t.supportedOS).join(", ") || "— указать —") + ".");
  doc.moveDown(0.3);
  label("Графический интерфейс: ", "на русском языке.");

  addPageNumbers(doc);
  return toBuffer(doc);
}

// ---------- Фрагмент исходного кода (≤ 50 страниц) ----------
const LINES_PER_PAGE = 50;
const MAX_PAGES = 50;
const HALF_PAGES = 25;

async function buildCodeFragmentPdf(product, listing) {
  const PDFDocument = requirePdfkit();
  const p = (product && product.product) || {};
  const doc = newDoc(PDFDocument);

  doc.font("serif-bold").fontSize(16).text("ФРАГМЕНТ ИСХОДНОГО КОДА", { align: "center" });
  doc.moveDown(0.3);
  doc.font("serif-bold").fontSize(13).text(p.name || "____", { align: "center" });
  doc.moveDown(1);

  const raw = String(listing || "");
  if (!raw.trim()) {
    doc.font("serif").fontSize(12).text(
      "Листинг исходного кода не найден. Сначала выполните подготовку — платформа соберёт снимок кода и листинг.");
    addPageNumbers(doc);
    return toBuffer(doc);
  }

  const allLines = raw.replace(/\t/g, "    ").split(/\r?\n/);
  const totalPages = Math.ceil(allLines.length / LINES_PER_PAGE);
  let lines;
  if (totalPages <= MAX_PAGES) {
    lines = allLines;
    doc.font("serif").fontSize(10).fillColor("#444")
      .text(`Листинг включён целиком (~${totalPages} стр., в пределах ${MAX_PAGES} страниц).`);
  } else {
    const head = allLines.slice(0, HALF_PAGES * LINES_PER_PAGE);
    const tail = allLines.slice(allLines.length - HALF_PAGES * LINES_PER_PAGE);
    lines = [...head, "", "/* … середина листинга опущена (правило ≤ 50 страниц Роспатента) … */", "", ...tail];
    doc.font("serif").fontSize(10).fillColor("#444")
      .text(`Исходный листинг — ~${totalPages} стр. Включены первые ${HALF_PAGES} и последние ${HALF_PAGES} страниц (итого ≤ ${MAX_PAGES}).`);
  }
  doc.moveDown(0.6);
  doc.fillColor("#000").font("mono").fontSize(8);
  // Построчно, без переносов — как листинг. lineGap плотный.
  doc.text(lines.join("\n"), { lineGap: 1, width: doc.page.width - 136 });

  addPageNumbers(doc);
  return toBuffer(doc);
}

// Проверка доступности (для диагностики): есть pdfkit и шрифты.
function status() {
  let hasPdfkit = false;
  try { require.resolve("pdfkit"); hasPdfkit = true; } catch (_) { /* нет */ }
  const hasFonts = fs.existsSync(SERIF) && fs.existsSync(SERIF_BOLD) && fs.existsSync(MONO);
  return { hasPdfkit, hasFonts };
}

module.exports = { buildReferatPdf, buildCodeFragmentPdf, status };
