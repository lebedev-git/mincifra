"use strict";
// CLI сбора артефактов реестра из ЛОКАЛЬНОЙ папки проекта (без сервера и без clone).
// Дополняет platform/core/prepare.js (тот работает по git-ссылке через data-слой) —
// здесь источник уже на диске, поэтому переиспользуем только чистые помощники prepare.
//
// Запуск:
//   node 01_collect/collect.js <путь-к-проекту> [--out <каталог>]
//
// Делает:
//   1) git archive HEAD → snapshot.zip + SHA-256   (если папка — git-репозиторий)
//   2) cdxgen → sbom.json                          (список библиотек и лицензий; нужен npx)
// Результат кладётся в <out> (по умолчанию <проект>/reestr-artifacts) и печатает строки
// для вставки в product.json (tech.sbomFile / снимок для «Акта фиксации версии»).
//
// Код возврата: 0 — что-то собрано; 2 — нет пути/каталога.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const prepare = require("../platform/core/prepare"); // hasTool/run/SBOM_TIMEOUT_MS — без побочек при загрузке

// Порог, выше которого снимок версии подозрительно велик (обычно — бинарные медиа
// в git-истории). Тогда для «Акта фиксации» лучше почистить историю (см. RUNBOOK).
const SNAPSHOT_WARN_BYTES = 100 * 1024 * 1024; // 100 МБ

// Запуск команды СТРОКОЙ через системный shell (кросс-платформенно). Нужен для npx:
// на Windows npx — это npx.cmd (batch), который spawn без shell не запускает
// (в отличие от git.exe). Пути берём в кавычки, поэтому пробелы в путях безопасны.
function runShell(cmdline, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmdline, { ...opts, shell: true });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve({ code: -1, stdout, stderr: stderr + "\n[timeout]" }); },
      opts.timeout || 60000);
    if (child.stdout) child.stdout.on("data", (d) => { stdout += d; });
    if (child.stderr) child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e.message || e) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
async function hasNpx() {
  const r = await runShell("npx --version", { timeout: 15000 });
  return r.code === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outArg = outIdx >= 0 ? args[outIdx + 1] : null;
  const dirArg = args.find((a, i) => !a.startsWith("--") && a !== outArg);

  if (!dirArg) {
    console.error("Укажите путь к проекту:  node 01_collect/collect.js <путь> [--out <каталог>]");
    process.exit(2);
  }
  const projectDir = path.resolve(process.cwd(), dirArg);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    console.error(`Каталог не найден: ${projectDir}`);
    process.exit(2);
  }
  const outDir = outArg ? path.resolve(process.cwd(), outArg) : path.join(projectDir, "reestr-artifacts");
  fs.mkdirSync(outDir, { recursive: true });

  console.log("");
  console.log("═══ Сбор артефактов реестра (локальная папка) ═══");
  console.log(`Проект: ${projectDir}`);
  console.log(`Выход:  ${outDir}`);
  console.log("");

  const summary = { snapshot: null, sha256: null, sbom: null, warnings: [] };

  // 1) Снимок версии — только для git-репозитория.
  const isGit = fs.existsSync(path.join(projectDir, ".git"));
  if (!(await prepare.hasTool("git"))) {
    summary.warnings.push("git не найден — снимок версии пропущен.");
  } else if (!isGit) {
    summary.warnings.push("Папка не является git-репозиторием — снимок версии (ZIP+SHA-256) пропущен.");
  } else {
    const zipPath = path.join(outDir, "snapshot.zip");
    console.log("1/2 Делаю чистый снимок версии (git archive HEAD → snapshot.zip)…");
    const r = await prepare.run("git", ["-C", projectDir, "archive", "--format=zip", "-o", zipPath, "HEAD"]);
    if (r.code === 0 && fs.existsSync(zipPath)) {
      const buf = fs.readFileSync(zipPath);
      summary.sha256 = crypto.createHash("sha256").update(buf).digest("hex");
      summary.snapshot = zipPath;
      console.log(`    ✅ snapshot.zip (${(buf.length / 1024 / 1024).toFixed(1)} МБ)`);
      console.log(`    SHA-256: ${summary.sha256}`);
      if (buf.length > SNAPSHOT_WARN_BYTES) {
        summary.warnings.push(`Снимок очень большой (${(buf.length / 1024 / 1024).toFixed(0)} МБ) — вероятно, ` +
          "бинарные медиа в git-истории. Для «Акта фиксации» лучше почистить историю (git rm --cached) — см. RUNBOOK.");
      }
    } else {
      summary.warnings.push("git archive завершился с ошибкой: " + prepare.firstLine(r.stderr));
    }
  }
  console.log("");

  // 2) SBOM через cdxgen по локальной папке.
  console.log("2/2 Генерирую SBOM (npx @cyclonedx/cdxgen по папке проекта)…");
  if (!(await hasNpx())) {
    summary.warnings.push("npx (Node.js) не найден — SBOM пропущен.");
    console.log("    ⚠ npx не найден — пропущено.");
  } else {
    const sbomPath = path.join(outDir, "sbom.json");
    const cmdline = `npx --yes @cyclonedx/cdxgen@latest -o "${sbomPath}" "${projectDir}"`;
    const r = await runShell(cmdline, { timeout: prepare.SBOM_TIMEOUT_MS });
    if (r.code === 0 && fs.existsSync(sbomPath)) {
      summary.sbom = sbomPath;
      console.log(`    ✅ sbom.json (${fs.statSync(sbomPath).size} байт)`);
    } else {
      summary.warnings.push("cdxgen не сгенерировал SBOM (нет сети или ошибка). Можно собрать вручную позже.");
      console.log("    ⚠ SBOM не сгенерирован (см. замечания).");
    }
  }

  // Итоги + подсказки для product.json.
  console.log("");
  console.log("─── Итог ───");
  if (summary.sbom) {
    console.log(`SBOM:    ${path.relative(process.cwd(), summary.sbom) || summary.sbom}`);
    console.log(`  → в product.json:  "tech": { "sbomFile": "${rel(summary.sbom)}", "sbomFormat": "cyclonedx-json" }`);
  }
  if (summary.snapshot) {
    console.log(`Снимок:  ${path.relative(process.cwd(), summary.snapshot) || summary.snapshot}`);
    console.log(`  SHA-256 (для «Акта фиксации версии»): ${summary.sha256}`);
  }
  if (summary.warnings.length) {
    console.log("");
    console.log("Замечания:");
    for (const w of summary.warnings) console.log(`  ⚠ ${w}`);
  }
  console.log("");
  console.log("Осталось вручную: сетевые доказательства (HAR/urls) для network_audit —");
  console.log("сними трафик страницы (DevTools → Network → экспорт HAR) или собери список доменов.");
  console.log("");
  process.exit(0);
}

function rel(p) {
  // Абсолютный путь → относительный от каталога pipeline (для аккуратного product.json).
  const PIPELINE = path.resolve(__dirname, "..");
  return path.relative(PIPELINE, p).replace(/\\/g, "/") || p;
}

main().catch((e) => { console.error("Ошибка сбора:", e.message || e); process.exit(1); });
