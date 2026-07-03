"use strict";
// Локальный источник кода вместо сетевого git clone (см. core/prepare.js).
// Убирает главную причину «падения» на тяжёлых репозиториях (обрыв fetch-pack на
// больших блобах): код берётся с ЭТОГО ПК — из указанной папки проекта или из
// загруженного ZIP. Сети для получения кода не требуется.
//
// Итог тот же, что у сетевого prepare (совместимо с депонированием):
//   dep_snapshot_snapshot.zip  — снимок версии (+ SHA-256 для «Акта фиксации»)
//   dep_codefrag_listing.txt   — листинг для «Фрагмента исходного кода»
//   sbom.json                  — если доступен npx/cdxgen (иначе пропуск с warning)
//
// Формат входа подтверждается ЯВНО (validateSource): папка должна существовать и
// содержать признаки проекта; ZIP — иметь сигнатуру ZIP. Иначе — понятная ошибка.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const store = require("./store");
const {
  hasTool, run, collectListing, firstLine, LISTING_ARTIFACT,
  SBOM_TIMEOUT_MS, httpError,
} = require("./prepare");

const MAX_ZIP_BYTES = 300 * 1024 * 1024; // предел на загружаемый ZIP-снимок
// Предел на снимок кода. Снимок для реестра — это ИСХОДНИКИ, а не гигабайты медиа/данных.
// Крупнее — не сохраняем (защита диска и памяти: Buffer у Node ограничен ~2 ГБ),
// а выдаём понятный warning с топ-файлами, чтобы их вынесли из репозитория.
const MAX_SNAPSHOT_BYTES = (Number(process.env.REESTR_MAX_SNAPSHOT_MB) || 300) * 1024 * 1024;
// Признаки, что папка/архив — действительно проект с кодом (а не случайная папка).
const PROJECT_MARKERS = [
  "package.json", "go.mod", "pom.xml", "build.gradle", "requirements.txt",
  "pyproject.toml", "Cargo.toml", "composer.json", "*.csproj", "*.sln", ".git",
];

// --- Валидация входа ------------------------------------------------------

// Проверяет локальный путь: существует, это каталог, похоже на проект.
// Возвращает абсолютный нормализованный путь либо бросает httpError(400/404/422).
function validateDirPath(rawPath) {
  const p = String(rawPath || "").trim();
  if (!p) throw httpError(400, "Укажите путь к папке проекта.");
  if (/[\r\n\0]/.test(p)) throw httpError(400, "Недопустимые символы в пути.");
  const abs = path.resolve(p);
  let st;
  try { st = fs.statSync(abs); }
  catch (_) { throw httpError(404, `Папка не найдена: ${abs}`); }
  if (!st.isDirectory()) throw httpError(400, "Указанный путь — не папка.");
  if (!looksLikeProject(abs))
    throw httpError(422, "В папке не найдено признаков проекта (package.json, .git, исходники). Проверьте путь.");
  return abs;
}

// Есть ли в каталоге хотя бы один маркер проекта или файл исходника.
function looksLikeProject(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return false; }
  const set = new Set(names);
  for (const m of PROJECT_MARKERS) {
    if (m.includes("*")) {
      const ext = m.replace("*", "");
      if (names.some((n) => n.endsWith(ext))) return true;
    } else if (set.has(m)) return true;
  }
  // Либо просто есть исходники в корне.
  return names.some((n) => /\.(js|mjs|cjs|ts|tsx|jsx|py|go|java|cs|php|rb|rs|c|cpp|kt|swift)$/i.test(n));
}

// Проверяет буфер ZIP по сигнатуре (PK\x03\x04 / пустой архив PK\x05\x06) и размеру.
function validateZipBuffer(buf) {
  if (!buf || !buf.length) throw httpError(400, "Пустой файл — загрузите ZIP-архив проекта.");
  if (buf.length > MAX_ZIP_BYTES)
    throw httpError(413, `ZIP слишком большой (> ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} МБ).`);
  const sig = buf.slice(0, 4).toString("hex");
  if (sig !== "504b0304" && sig !== "504b0506" && sig !== "504b0708")
    throw httpError(422, "Файл не похож на ZIP-архив (нет сигнатуры PK). Загрузите .zip со снимком проекта.");
  return buf;
}

// --- Извлечение ZIP (для чтения метаданных/листинга/SBOM) -----------------
// Без npm-зависимостей: пробуем доступные системные распаковщики по очереди.
// Если ни один не сработал — возвращаем null (снимок из самого ZIP всё равно готов).
async function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const ok = () => { try { return fs.readdirSync(destDir).length > 0; } catch (_) { return false; } };
  // 1) PowerShell Expand-Archive (Windows) — пробуем напрямую (PowerShell не понимает
  //    «--version», поэтому hasTool для него ненадёжен; определяем успех по результату).
  if (process.platform === "win32") {
    const r = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`]);
    if (r.code === 0 && ok()) return destDir;
  }
  // 2) unzip (Linux)
  if (await hasTool("unzip")) {
    const r = await run("unzip", ["-q", "-o", zipPath, "-d", destDir]);
    if (r.code === 0 && ok()) return destDir;
  }
  // 3) bsdtar/системный tar (macOS, Windows-системный tar) читает zip: tar -xf a.zip -C dest.
  //    GNU tar (git-bash) zip не читает — тогда просто не сработает и вернём null.
  {
    const r = await run("tar", ["-xf", zipPath, "-C", destDir]);
    if (r.code === 0 && ok()) return destDir;
  }
  return null;
}

// Если распакованный ZIP содержит единственную корневую папку — работаем внутри неё
// (частый случай: архив собран как one-folder-top). Иначе — как есть.
function unwrapSingleRoot(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return dir; }
  const visible = entries.filter((e) => !e.name.startsWith("."));
  if (visible.length === 1 && visible[0].isDirectory()) return path.join(dir, visible[0].name);
  return dir;
}

// --- Снимок каталога ------------------------------------------------------

// Есть ли git-репозиторий в каталоге (тогда снимок делаем чистым git archive).
function isGitRepo(dir) {
  try { return fs.existsSync(path.join(dir, ".git")); } catch (_) { return false; }
}

// Размер трекнутых файлов git и топ-нарушители — чтобы не архивировать гигантский репо
// и подсказать, что вынести. Возвращает { bytes, top:[{path, mb}] } либо null (не git).
async function gitTrackedSize(dir) {
  const r = await run("git", ["-C", dir, "ls-tree", "-r", "-l", "HEAD"]);
  if (r.code !== 0) return null;
  let bytes = 0; const rows = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    // формат: <mode> <type> <sha> <size>\t<path>
    const m = line.match(/^\S+\s+\S+\s+\S+\s+(\d+)\t(.+)$/);
    if (!m) continue;
    const sz = Number(m[1]); bytes += sz; rows.push({ path: m[2], sz });
  }
  rows.sort((a, b) => b.sz - a.sz);
  return { bytes, top: rows.slice(0, 5).map((x) => ({ path: x.path, mb: +(x.sz / 1048576).toFixed(1) })) };
}

// Собирает снимок каталога. Возвращает { file, name } (name — имя артефакта с верным
// расширением) либо null (снимок не создан/слишком большой — с warning).
// Порядок: git archive (чистый zip) → системный zip-архиватор → GNU tar.gz (крайний,
// но всегда доступный). Инструменты ПРОБУЮТСЯ напрямую по результату — без опоры на
// «--version» (его, напр., не понимает PowerShell).
async function snapshotDir(dir, work, warnings) {
  const zipPath = path.join(work, "snapshot.zip");

  // git-репо → чистый снимок трекнутых файлов (без .git/untracked). С предчеком размера.
  if (isGitRepo(dir) && (await hasTool("git"))) {
    const sz = await gitTrackedSize(dir);
    if (sz && sz.bytes > MAX_SNAPSHOT_BYTES) {
      const top = sz.top.map((f) => `${f.mb} МБ — ${f.path}`).join("; ");
      warnings.push(
        `Снимок кода не сохранён: размер трекнутых файлов ${(sz.bytes / 1048576).toFixed(0)} МБ ` +
        `превышает лимит ${(MAX_SNAPSHOT_BYTES / 1048576).toFixed(0)} МБ. В реестр подаётся снимок ИСХОДНИКОВ — ` +
        `вынесите крупные бинарные/пользовательские файлы из репозитория (.gitignore). Самые большие: ${top}.`);
      return null;
    }
    const r = await run("git", ["-C", dir, "archive", "--format=zip", "-o", zipPath, "HEAD"]);
    if (r.code === 0 && fs.existsSync(zipPath)) return { file: zipPath, name: "dep_snapshot_snapshot.zip" };
    warnings.push("git archive не удался — собираю обычный снимок каталога.");
  }

  // Не git: пробуем системные zip-архиваторы напрямую (успех определяем по файлу).
  // 1) PowerShell Compress-Archive (Windows).
  if (process.platform === "win32") {
    const r = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      `Compress-Archive -Path '${dir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`]);
    if (r.code === 0 && fs.existsSync(zipPath)) return { file: zipPath, name: "dep_snapshot_snapshot.zip" };
  }
  // 2) zip (Linux/macOS).
  if (await hasTool("zip")) {
    const r = await run("zip", ["-r", "-q", zipPath, "."], { cwd: dir });
    if (r.code === 0 && fs.existsSync(zipPath)) return { file: zipPath, name: "dep_snapshot_snapshot.zip" };
  }
  // 3) bsdtar умеет zip (Windows-системный tar / macOS): tar -a -cf x.zip.
  {
    const r = await run("tar", ["-a", "-c", "-f", zipPath, "-C", dir, "."]);
    if (r.code === 0 && fs.existsSync(zipPath)) return { file: zipPath, name: "dep_snapshot_snapshot.zip" };
  }
  // 4) Крайний путь: GNU tar → .tar.gz (ZIP не умеет, но tar.gz есть почти везде).
  if (await hasTool("tar")) {
    const tgz = path.join(work, "snapshot.tar.gz");
    const r = await run("tar", ["-c", "-z", "-f", tgz, "-C", dir, "."]);
    if (r.code === 0 && fs.existsSync(tgz)) return { file: tgz, name: "dep_snapshot_snapshot.tar.gz" };
  }

  warnings.push("Не найден инструмент архивации (git/zip/PowerShell/tar) — снимок не создан. Можно загрузить ZIP вручную.");
  return null;
}

// --- Основной сценарий ----------------------------------------------------

// source: { kind: "path", path } | { kind: "zip", buffer }
// Возвращает { archive, sha256, sizeBytes, sbom|null, listing|null, srcDir, warnings, cleanup }.
// srcDir — каталог с исходниками для чтения метаданных (autofill). cleanup() удаляет temp.
async function build(id, source, onStep = () => {}) {
  store.getProduct(id); // 404, если продукта нет
  const warnings = [];
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "reestr-local-"));
  let srcDir = null;
  let presetZipPath = null;

  try {
    if (source && source.kind === "zip") {
      onStep("1/4 Проверяю формат ZIP…");
      validateZipBuffer(source.buffer);
      presetZipPath = path.join(work, "input.zip");
      fs.writeFileSync(presetZipPath, source.buffer);
      onStep("2/4 Распаковываю для чтения данных…");
      const extracted = await extractZip(presetZipPath, path.join(work, "src"));
      if (extracted) srcDir = unwrapSingleRoot(extracted);
      else warnings.push("ZIP не удалось распаковать на этом ПК — метаданные и листинг пропущены, снимок и SHA-256 готовы.");
    } else {
      onStep("1/4 Проверяю папку проекта…");
      srcDir = validateDirPath(source && source.path);
    }

    // Снимок: для ZIP это сам загруженный архив; для папки — git archive / zip / tar.gz.
    onStep("3/4 Формирую снимок версии и SHA-256…");
    let snapFile = presetZipPath;
    let snapName = "dep_snapshot_snapshot.zip";
    if (!snapFile && srcDir) {
      const snap = await snapshotDir(srcDir, work, warnings);
      if (snap) { snapFile = snap.file; snapName = snap.name; }
    }

    let sha256 = null, sizeBytes = 0, archive = null;
    if (snapFile && fs.existsSync(snapFile)) {
      const st = fs.statSync(snapFile);
      if (st.size > MAX_SNAPSHOT_BYTES) {
        // Дублирующая страховка для не-git путей (ZIP/папка без git), где предчека не было.
        warnings.push(
          `Снимок кода не сохранён: размер ${(st.size / 1048576).toFixed(0)} МБ превышает лимит ` +
          `${(MAX_SNAPSHOT_BYTES / 1048576).toFixed(0)} МБ. Уберите крупные файлы из проекта/архива.`);
      } else {
        const zipBuf = fs.readFileSync(snapFile);
        sha256 = crypto.createHash("sha256").update(zipBuf).digest("hex");
        sizeBytes = zipBuf.length;
        store.saveArtifact(id, snapName, zipBuf);
        archive = snapName;
      }
    }

    // Листинг для «Фрагмента исходного кода» — если есть распакованные исходники.
    let listing = null;
    if (srcDir) {
      try {
        const text = collectListing(srcDir);
        if (text) { store.saveArtifact(id, LISTING_ARTIFACT, Buffer.from(text, "utf8")); listing = LISTING_ARTIFACT; }
      } catch (e) { warnings.push("Не удалось собрать листинг кода: " + (e.message || e)); }
    }

    // SBOM — опционально, если есть npx и распакованные исходники.
    onStep("4/4 Генерирую SBOM (список библиотек и лицензий)…");
    let sbom = null;
    if (srcDir && (await hasTool("npx"))) {
      const sbomPath = path.join(work, "sbom.json");
      const gen = await run("npx", ["--yes", "@cyclonedx/cdxgen@latest", "-o", sbomPath, srcDir],
        { timeout: SBOM_TIMEOUT_MS });
      if (gen.code === 0 && fs.existsSync(sbomPath)) {
        store.saveArtifact(id, "sbom.json", fs.readFileSync(sbomPath));
        sbom = "sbom.json";
      } else {
        warnings.push("SBOM не сгенерирован (cdxgen недоступен или нет сети). SBOM можно загрузить вручную.");
      }
    } else if (srcDir) {
      warnings.push("SBOM пропущен: не найден npx (Node.js).");
    }

    // srcDir отдаём наружу для autofill; но если это папка пользователя — НЕ удаляем её,
    // удаляем только временный каталог work в cleanup().
    const userDir = source && source.kind === "path";
    return {
      archive, sha256, sizeBytes, sbom, listing, warnings,
      srcDir,
      cleanup: () => { try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* temp */ } void userDir; },
    };
  } catch (err) {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* temp */ }
    throw err;
  }
}

module.exports = {
  build, validateDirPath, validateZipBuffer, looksLikeProject, isGitRepo,
  MAX_ZIP_BYTES,
};
