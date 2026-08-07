"use strict";
// Прямая генерация итоговых PDF для подачи в Роспатент (ст. 1262 ГК): реферат и
// фрагмент исходного кода. Шрифт — Liberation Serif (метрически совместим с Times
// New Roman, с кириллицей); код — Liberation Mono. Шрифты забандлены в ./fonts, поэтому
// PDF одинаков локально и на сервере, без завязки на системные шрифты.
//
// Зависимость pdfkit — опциональная (как docx): ищется лениво, понятная ошибка если нет.
// buildReferatPdf / buildCodeFragmentPdf возвращают { buffer, pages }.

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

// Собирает поток PDFKit в { buffer, pages }. Число страниц нужно для графы 9
// заявления («на ___ л.»), поэтому считаем его до закрытия документа.
function toBuffer(doc, pages) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve({ buffer: Buffer.concat(chunks), pages }));
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
// Возвращает число страниц: после flushPages() буфер обнуляется и посчитать уже нельзя.
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
  return range.count;
}

// ---------- Реферат программы для ЭВМ ----------
// Текст реферата НЕ собирается здесь: он приходит готовым из core/rospatent.js
// (п. 30 Правил, лимит 900 знаков) — один источник и для формы, и для PDF.
// Печать через 1,5 интервала — требование п. 30.
async function buildReferatPdf(product, referatText, titleInfo) {
  const PDFDocument = requirePdfkit();
  const p = (product && product.product) || {};
  const doc = newDoc(PDFDocument);

  doc.font("serif-bold").fontSize(16).text("РЕФЕРАТ", { align: "center" });
  doc.moveDown(1);

  // Шапка реферата в принятом ФИПС виде: правообладатель, авторы, название.
  // Сам текст реферата (аннотация + обязательный хвост п. 30) идёт ниже.
  const line = (label, value) => {
    doc.font("serif-bold").fontSize(12).text(label, { continued: true });
    doc.font("serif").text(value || "____");
    doc.moveDown(0.25);
  };
  const authors = asList(titleInfo && titleInfo.authors).filter(Boolean);
  line("Правообладатель: ", (titleInfo && titleInfo.rightholder) || "");
  line(authors.length > 1 ? "Авторы: " : "Автор: ", authors.join("; "));
  line("Название программы для ЭВМ: ", p.name || "");
  doc.moveDown(0.8);

  const text = String(referatText || "").trim() || "— реферат не сформирован: заполните карточку продукта —";
  // lineGap ≈ половина кегля даёт межстрочный интервал 1,5.
  doc.font("serif").fontSize(12).text(text, { align: "justify", lineGap: 6 });

  return toBuffer(doc, addPageNumbers(doc));
}

// ---------- Титульный лист депонируемых материалов (п. 29 Правил) ----------
// Обязателен: название программы, правообладатель и все авторы (если не отказались
// быть упомянутыми). Печатается первой страницей файла с фрагментом кода.
function drawTitlePage(doc, { name, rightholder, authors }) {
  doc.font("serif-bold").fontSize(14).text("ДЕПОНИРУЕМЫЕ МАТЕРИАЛЫ,", { align: "center" });
  doc.font("serif-bold").fontSize(14).text("ИДЕНТИФИЦИРУЮЩИЕ ПРОГРАММУ ДЛЯ ЭВМ", { align: "center" });
  doc.moveDown(2);

  doc.font("serif").fontSize(12).text("Название программы для ЭВМ:", { align: "center" });
  doc.moveDown(0.4);
  doc.font("serif-bold").fontSize(14).text(name || "____", { align: "center" });
  doc.moveDown(2.5);

  doc.font("serif").fontSize(12).text("Правообладатель:", { align: "center" });
  doc.moveDown(0.3);
  doc.font("serif-bold").fontSize(12).text(rightholder || "____", { align: "center" });
  doc.moveDown(1.5);

  const list = asList(authors).filter(Boolean);
  doc.font("serif").fontSize(12).text(list.length > 1 ? "Авторы:" : "Автор:", { align: "center" });
  doc.moveDown(0.3);
  doc.font("serif-bold").fontSize(12).text(list.length ? list.join("; ") : "____", { align: "center" });

  doc.addPage();
}

// ---------- Фрагмент исходного кода ----------
// П. 27 Правил: материалы представляются «в объёме, достаточном для идентификации»;
// прежнее ограничение в 70 страниц отменено. MAX_PAGES — наш рабочий предел по
// рекомендации ФИПС для электронной подачи, а не норма права.
const LINES_PER_PAGE = 50;
const MAX_PAGES = 50;
const HALF_PAGES = 25;

async function buildCodeFragmentPdf(product, listing, titleInfo) {
  const PDFDocument = requirePdfkit();
  const p = (product && product.product) || {};
  const doc = newDoc(PDFDocument);

  // Титульный лист депонируемых материалов (п. 29) — обязательная первая страница.
  drawTitlePage(doc, {
    name: p.name,
    rightholder: (titleInfo && titleInfo.rightholder) || "",
    authors: (titleInfo && titleInfo.authors) || [],
  });

  doc.font("serif-bold").fontSize(16).text("ФРАГМЕНТ ИСХОДНОГО КОДА", { align: "center" });
  doc.moveDown(0.3);
  doc.font("serif-bold").fontSize(13).text(p.name || "____", { align: "center" });
  doc.moveDown(1);

  const raw = String(listing || "");
  if (!raw.trim()) {
    doc.font("serif").fontSize(12).text(
      "Листинг исходного кода не найден. Сначала выполните подготовку — платформа соберёт снимок кода и листинг.");
    return toBuffer(doc, addPageNumbers(doc));
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
    lines = [...head, "", `/* … середина листинга опущена (объём ограничен ${MAX_PAGES} страницами) … */`, "", ...tail];
    doc.font("serif").fontSize(10).fillColor("#444")
      .text(`Исходный листинг — ~${totalPages} стр. Включены первые ${HALF_PAGES} и последние ${HALF_PAGES} страниц (итого ≤ ${MAX_PAGES}).`);
  }
  doc.moveDown(0.6);
  doc.fillColor("#000").font("mono").fontSize(8);
  // Построчно, без переносов — как листинг. lineGap плотный.
  doc.text(lines.join("\n"), { lineGap: 1, width: doc.page.width - 136 });

  return toBuffer(doc, addPageNumbers(doc));
}

// Проверка доступности (для диагностики): есть pdfkit и шрифты.
function status() {
  let hasPdfkit = false;
  try { require.resolve("pdfkit"); hasPdfkit = true; } catch (_) { /* нет */ }
  const hasFonts = fs.existsSync(SERIF) && fs.existsSync(SERIF_BOLD) && fs.existsSync(MONO);
  return { hasPdfkit, hasFonts };
}

module.exports = { buildReferatPdf, buildCodeFragmentPdf, status };
