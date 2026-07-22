"use strict";
// CLI фиксера шрифтов: перенос веб-шрифтов с внешнего CDN в локальный self-host.
//
// Запуск:
//   node 04_fixers/fix_fonts.js <путь-к-проекту>            — СУХОЙ ПРОГОН (офлайн): что найдено и что будет сделано
//   node 04_fixers/fix_fonts.js <путь-к-проекту> --apply    — ПРИМЕНИТЬ (сеть): скачать шрифты и переписать CSS
//
// Код возврата: 0 — успех/чисто; 1 — ошибка применения; 2 — нет пути/каталога.

const fs = require("fs");
const path = require("path");
const fonts = require("./selfhost_fonts");

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dir = args.find((a) => !a.startsWith("--"));

  if (!dir) {
    console.error("Укажите путь к проекту:  node 04_fixers/fix_fonts.js <путь> [--apply]");
    process.exit(2);
  }
  const projectDir = path.resolve(process.cwd(), dir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    console.error(`Каталог не найден: ${projectDir}`);
    process.exit(2);
  }

  console.log("");
  console.log("═══ Фиксер шрифтов (self-host внешних веб-шрифтов) ═══");
  console.log(`Проект: ${projectDir}`);
  console.log("");

  const scan = fonts.scan(projectDir);
  console.log(fonts.summarize(scan));
  console.log("");

  if (scan.clean) {
    process.exit(0);
  }

  // Детализация находок.
  if (scan.cssHits.length) {
    console.log("CSS-файлы с внешним шрифтом (будут авто-исправлены):");
    for (const h of scan.cssHits) {
      console.log(`  • ${path.relative(projectDir, h.file).replace(/\\/g, "/")}`);
      for (const r of h.refs) console.log(`      строка ${r.line}: ${r.url}`);
    }
    console.log("");
  }
  if (scan.markupHits.length) {
    console.log("Ссылки в разметке (link/JSX) — авто-фикс НЕ покрывает, править вручную:");
    for (const h of scan.markupHits) {
      console.log(`  • ${path.relative(projectDir, h.file).replace(/\\/g, "/")}`);
    }
    console.log("");
  }

  if (!apply) {
    console.log("Это сухой прогон (сеть не используется). Ничего не изменено.");
    console.log("Чтобы применить (скачать шрифты и переписать CSS):");
    console.log(`  node 04_fixers/fix_fonts.js "${dir}" --apply`);
    console.log("");
    process.exit(0);
  }

  console.log("Применяю (сетевая операция: скачиваю шрифты)…");
  console.log("");
  fonts.apply(scan, { onStep: (m) => console.log(`  … ${m}`) })
    .then((res) => {
      console.log("");
      if (!res.changed) {
        console.log(res.note || "Изменений не внесено.");
        process.exit(0);
      }
      console.log(`Готово. Скачано шрифтов: ${res.fontsCount}. Изменённые файлы:`);
      for (const f of res.files) console.log(`  ✅ ${f}`);
      if (res.fonts && res.fonts.length) {
        console.log("Файлы шрифтов:");
        for (const f of res.fonts) console.log(`     ${f}`);
      }
      if (res.warnings && res.warnings.length) {
        console.log("");
        console.log("Замечания:");
        for (const w of res.warnings) console.log(`  ⚠ ${w}`);
      }
      console.log("");
      console.log("Оригиналы CSS сохранены рядом с расширением .bak. Пересоберите проект и проверьте вид.");
      console.log("Затем прогоните network_audit заново — обращения к внешнему шрифт-CDN должны исчезнуть.");
      console.log("");
      process.exit(0);
    })
    .catch((e) => {
      console.error("");
      console.error("Ошибка применения:", e.message || e);
      console.error("Изменения могли быть частичными — проверьте .bak-файлы для отката.");
      process.exit(1);
    });
}

main();
