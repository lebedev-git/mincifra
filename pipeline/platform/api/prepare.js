"use strict";
// API подготовки артефактов и автозаполнения карточки.
//
// Сетевой путь (существующий, по ссылке на git):
//   POST /api/products/:id/prepare       — тело { repo } → клон, снимок, SHA-256, SBOM
//
// Локальный путь (без сети — устраняет «падение» на тяжёлых репозиториях):
//   POST /api/products/:id/autofill      — источник = папка или ZIP на этом ПК:
//       • JSON  { path, notes }          — локальная папка проекта
//       • RAW   тело = .zip, ?notes=...  — загруженный ZIP-снимок
//     Делает снимок/SHA-256/SBOM (как prepare) И возвращает ЧЕРНОВИК полей карточки.
//
//   GET  /api/prepare/status             — доступность git / npx / LLM (для UI)

const prepare = require("../core/prepare");
const localsource = require("../core/localsource");
const autofill = require("../core/autofill");
const llm = require("../core/llm");
const store = require("../core/store");
const { readBody, readJsonBody, sendJson } = require("../core/http-util");

function register(router) {
  router.get("/api/prepare/status", async (req, res) => {
    const st = await prepare.status();
    sendJson(res, 200, { ...st, llm: llm.isEnabled() });
  });

  // Сетевой prepare по ссылке (оставлен как запасной путь).
  router.post("/api/products/:id/prepare", async (req, res) => {
    const body = await readJsonBody(req);
    const result = await prepare.prepare(req.params.id, body.repo);
    sendJson(res, 200, { result, artifacts: store.listArtifacts(req.params.id) });
  });

  // Локальный источник + автозаполнение карточки. Источник определяется по Content-Type:
  // application/json → локальная папка; иначе → сырое тело ZIP.
  router.post("/api/products/:id/autofill", async (req, res) => {
    const { id } = req.params;
    const ctype = String(req.headers["content-type"] || "");
    const url = new URL(req.url, "http://localhost");

    let source, notes;
    if (ctype.includes("application/json")) {
      const body = await readJsonBody(req);
      source = { kind: "path", path: body.path };
      notes = body.notes;
    } else {
      // ZIP-снимок — тело крупнее обычного лимита; берём предел из localsource.
      const buf = await readBody(req, localsource.MAX_ZIP_BYTES);
      source = { kind: "zip", buffer: buf };
      notes = url.searchParams.get("notes") || "";
    }

    // 1) Снимок/SHA-256/SBOM из локального источника (артефакты сохраняются в продукт).
    const built = await localsource.build(id, source);
    try {
      // 2) Черновик полей карточки из распакованных исходников + заметок пользователя.
      const draft = await autofill.buildDraft({ srcDir: built.srcDir, notes });
      const result = {
        archive: built.archive, sha256: built.sha256, sizeBytes: built.sizeBytes,
        sbom: built.sbom, listing: built.listing,
        warnings: [...(built.warnings || []), ...(draft.warnings || [])],
      };
      sendJson(res, 200, {
        result,
        draft: { patch: draft.patch, applied: draft.applied, facts: draft.facts, llm: draft.llm },
        artifacts: store.listArtifacts(id),
      });
    } finally {
      built.cleanup();
    }
  });
}

module.exports = { register };
