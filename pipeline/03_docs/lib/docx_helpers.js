"use strict";
// Общие docx-хелперы для генерации документов пайплайна.
// Стиль наследует ../../gen_zapiska.js (шрифт Arial, синяя палитра, note-боксы,
// таблицы). Вынесено в модуль, чтобы не дублировать код и не трогать рабочий
// генератор аналитической записки.

const path = require("path");
const docx = resolveDocx();

// Находит модуль docx без хардкода пути пользователя. Порядок:
//   1) обычный require («docx» рядом/в node_modules/NODE_PATH) — локальная установка;
//   2) вычисленные глобальные npm root по окружению (Windows: %APPDATA%\npm; Unix: рядом с node);
//   3) `npm root -g` как крайний фолбэк;
//   4) понятная ошибка с инструкцией по установке.
function resolveDocx() {
  try { return require("docx"); } catch (_) { /* пробуем глобально */ }

  const { createRequire } = require("module");
  const candidates = [];
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, "npm", "node_modules"));
  if (process.env.npm_config_prefix) candidates.push(path.join(process.env.npm_config_prefix, "node_modules"));
  // Unix-раскладка: <prefix>/bin/node → <prefix>/lib/node_modules
  candidates.push(path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules"));
  candidates.push(path.resolve(path.dirname(process.execPath), "node_modules"));

  for (const root of candidates) {
    try {
      const req = createRequire(path.join(root, "index.js"));
      return req("docx");
    } catch (_) { /* следующий кандидат */ }
  }

  // Крайний фолбэк — спросить у npm его глобальный root (медленнее, требует npm в PATH).
  try {
    const root = require("child_process")
      .execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim();
    if (root) {
      const req = require("module").createRequire(path.join(root, "index.js"));
      return req("docx");
    }
  } catch (_) { /* не нашли */ }

  throw new Error(
    "Не найден модуль «docx». Установите его глобально:  npm install -g docx\n" +
    "или локально в каталоге платформы:  npm install docx"
  );
}
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak,
} = docx;

const FONT = "Arial";
const BLUE = "1F4E79";
const GREY = "CCCCCC";

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });

function P(runs, opts = {}) {
  const children = Array.isArray(runs) ? runs : [new TextRun(runs)];
  return new Paragraph({ children, spacing: { after: 120, line: 276 }, ...opts });
}
function bullet(runs, level = 0) {
  const children = Array.isArray(runs) ? runs : [new TextRun(runs)];
  return new Paragraph({ numbering: { reference: "bul", level }, spacing: { after: 60, line: 264 }, children });
}
function num(runs) {
  const children = Array.isArray(runs) ? runs : [new TextRun(runs)];
  return new Paragraph({ numbering: { reference: "ord", level: 0 }, spacing: { after: 60, line: 264 }, children });
}
const R = (text, opts = {}) => new TextRun({ text, ...opts });
const B = (text) => new TextRun({ text, bold: true });
const sp = (after = 120) => new Paragraph({ spacing: { after } });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

// note-бокс (одна ячейка с рамкой-акцентом слева)
function note(title, lines, fill = "FFF2CC") {
  const kids = [new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: title, bold: true })] })];
  lines.forEach((l) => kids.push(new Paragraph({
    spacing: { after: 40, line: 264 },
    children: Array.isArray(l) ? l : [new TextRun(l)],
  })));
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      width: { size: 9360, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 120, bottom: 120, left: 160, right: 160 },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 6, color: "E8A33D" },
        bottom: { style: BorderStyle.SINGLE, size: 6, color: "E8A33D" },
        left: { style: BorderStyle.SINGLE, size: 18, color: "E8A33D" },
        right: { style: BorderStyle.SINGLE, size: 6, color: "E8A33D" },
      },
      children: kids,
    })] })],
  });
}

// Универсальная таблица: header + строки (чередование фона).
function tbl(colWidths, headerCells, rows, headerFill = BLUE) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: GREY };
  const borders = { top: border, bottom: border, left: border, right: border };
  const mkCell = (content, w, opts = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    ...opts,
    children: (Array.isArray(content) ? content : [content]).map((c) =>
      typeof c === "string" ? new Paragraph({ children: [new TextRun(c)] }) : c),
  });
  const headerRow = new TableRow({
    tableHeader: true,
    children: headerCells.map((h, i) => mkCell(
      new Paragraph({ children: [new TextRun({ text: h, bold: true, color: "FFFFFF" })] }),
      colWidths[i], { shading: { fill: headerFill, type: ShadingType.CLEAR } })),
  });
  const bodyRows = rows.map((r, ri) => new TableRow({
    children: r.map((cell, ci) => mkCell(
      typeof cell === "string" ? new Paragraph({ children: [new TextRun(cell)] }) : cell,
      colWidths[ci],
      ri % 2 === 1 ? { shading: { fill: "F2F6FB", type: ShadingType.CLEAR } } : {})),
  }));
  return new Table({
    width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: colWidths, rows: [headerRow, ...bodyRows],
  });
}

// Титульный блок документа.
function titleBlock(title, subtitle, meta) {
  const out = [];
  out.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 120 },
    children: [new TextRun({ text: title, bold: true, size: 40, color: BLUE })],
  }));
  if (subtitle) out.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 80 },
    children: [new TextRun({ text: subtitle, size: 26, color: "404040" })],
  }));
  (meta || []).forEach((m) => out.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [new TextRun({ text: m, size: 22, color: "606060" })],
  })));
  return out;
}

// Сборка .docx в Buffer (без записи на диск). children — массив параграфов/таблиц.
function buildBuffer(children, { title, header } = {}) {
  const doc = new Document({
    creator: "Пайплайн реестра ПО",
    title: title || "Документ",
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 30, bold: true, font: FONT, color: BLUE },
          paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 25, bold: true, font: FONT, color: "2E5496" },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 22, bold: true, font: FONT, color: "404040" },
          paragraph: { spacing: { before: 140, after: 80 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: "bul", levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 600, hanging: 280 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 280 } } } },
        ] },
        { reference: "ord", levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 600, hanging: 320 } } } },
        ] },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GREY, space: 4 } },
        children: [new TextRun({ text: header || title || "", size: 16, color: "808080" })],
      })] }) },
      footers: { default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "стр. ", size: 16, color: "808080" }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "808080" }),
          new TextRun({ text: " из ", size: 16, color: "808080" }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "808080" }),
        ],
      })] }) },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

// Сборка и запись .docx на диск. Переиспользует buildBuffer.
async function build(children, { title, header, outPath }) {
  const buf = await buildBuffer(children, { title, header });
  require("fs").writeFileSync(outPath, buf);
  return { outPath, bytes: buf.length };
}

module.exports = {
  docx, H1, H2, H3, P, bullet, num, R, B, sp, pageBreak, note, tbl,
  titleBlock, build, buildBuffer, FONT, BLUE,
};
