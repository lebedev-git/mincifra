"use strict";
// API генерации досье. POST — сгенерировать, GET — список/скачивание .docx.

const store = require("../core/store");
const docsAdapter = require("../core/docs-adapter");
const deponAdapter = require("../core/depon-adapter");
const assignmentAdapter = require("../core/assignment-adapter");
const { sendJson, sendFile } = require("../core/http-util");

function register(router) {
  router.post("/api/products/:id/dossier", async (req, res) => {
    const result = await docsAdapter.generateForProduct(req.params.id);
    // Не отдаём абсолютные пути наружу — только имена и размеры.
    const docs = result.docs.map((d) => ({ name: d.name, title: d.title, bytes: d.bytes }));
    sendJson(res, 200, { docs, generatedAt: result.generatedAt });
  });

  // Генерация одного документа депонирования (реферат/акт/цепочка/заявление).
  // Сохраняется как артефакт dep_*_… и закрывает пункт трекера.
  router.post("/api/products/:id/depon/:kind", async (req, res) => {
    const result = await deponAdapter.generate(req.params.id, req.params.kind);
    sendJson(res, 200, { generated: result, artifacts: store.listArtifacts(req.params.id) });
  });

  // Генерация документа отчуждения права (договор / акт) — Схема B.
  // Сохраняется как артефакт dep_assign_*_… и закрывает пункт трекера отчуждения.
  router.post("/api/products/:id/assign/:kind", async (req, res) => {
    const result = await assignmentAdapter.generate(req.params.id, req.params.kind);
    sendJson(res, 200, { generated: result, artifacts: store.listArtifacts(req.params.id) });
  });

  router.get("/api/products/:id/dossier", (req, res) => {
    sendJson(res, 200, { docs: store.listDossier(req.params.id) });
  });

  router.get("/api/products/:id/dossier/:file", (req, res) => {
    const file = store.dossierFilePath(req.params.id, req.params.file);
    sendFile(res, file, { download: true });
  });
}

module.exports = { register };
