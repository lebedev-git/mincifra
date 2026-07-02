"use strict";
// API артефактов (SBOM/HAR). Загрузка — сырым телом PUT (без multipart):
//   PUT /api/products/:id/artifacts/:kind?name=<имя файла>
// kind ∈ { sbom, har }. Имя файла берётся из ?name, иначе — дефолтное по kind.

const store = require("../core/store");
const { readBody, sendJson, sendFile, errWithStatus } = require("../core/http-util");

// kind → дефолтное имя. sbom/har — для авто-проверок; rights и dep_* — документы
// подготовки к депонированию (в технических проверках не участвуют).
const DEFAULT_NAME = { sbom: "sbom.json", har: "network.har", rights: "rospatent.pdf" };
// Разрешённые категории документов депонирования: dep_snapshot, dep_referat и т.п.
const DOC_KIND = /^(rights|dep_[a-z]+)$/;

// Приводит имя к виду, по которому распознаётся тип. sbom/har — под адаптер проверок,
// документы — префикс = kind (dep_snapshot_..., dep_cert_...), чтобы группировать по пунктам.
function normalizeName(kind, name) {
  if (kind === "sbom") return /sbom|cyclonedx|bom|\.cdx/i.test(name) ? name : `sbom_${name}`;
  if (kind === "har") return /\.har$|network/i.test(name) ? name : `network_${name}`;
  const pref = kind + "_";
  return name.toLowerCase().startsWith(pref) ? name : pref + name;
}

function register(router) {
  router.get("/api/products/:id/artifacts", (req, res) => {
    sendJson(res, 200, { artifacts: store.listArtifacts(req.params.id) });
  });

  // Скачивание ранее загруженного артефакта (в т.ч. свидетельства Роспатента).
  router.get("/api/products/:id/artifacts/file/:name", (req, res) => {
    const p = store.artifactPath(req.params.id, req.params.name);
    sendFile(res, p, { download: true });
  });

  router.put("/api/products/:id/artifacts/:kind", async (req, res) => {
    const { id, kind } = req.params;
    if (!DEFAULT_NAME[kind] && !DOC_KIND.test(kind)) throw errWithStatus(400, "Недопустимый тип артефакта");
    const buf = await readBody(req);
    if (!buf.length) throw errWithStatus(400, "Пустое тело — нечего сохранять");

    const url = new URL(req.url, "http://localhost");
    const name = url.searchParams.get("name") || DEFAULT_NAME[kind] || `${kind}.dat`;
    const finalName = normalizeName(kind, name);

    const rel = store.saveArtifact(id, finalName, buf);
    sendJson(res, 201, { saved: rel, artifacts: store.listArtifacts(id) });
  });

  router.delete("/api/products/:id/artifacts/:name", (req, res) => {
    const p = store.artifactPath(req.params.id, req.params.name);
    require("fs").rmSync(p, { force: true });
    sendJson(res, 200, { ok: true, artifacts: store.listArtifacts(req.params.id) });
  });
}

module.exports = { register };
