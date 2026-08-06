"use strict";
// Самопроверка упаковки локального источника (сети не требует):
//   node mcp/selftest.js
// Проверяет, что zipLocalDir отдаёт валидный ZIP (сигнатура PK) и чистит temp,
// а readLocalFile читает файл и ругается на отсутствующий.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { zipLocalDir, readLocalFile, TOOLS } = require("./server");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reestr-selftest-"));
fs.writeFileSync(path.join(dir, "package.json"), '{"name":"demo","version":"1.0.0"}');
fs.writeFileSync(path.join(dir, "index.js"), "console.log('demo');\n");

const packed = zipLocalDir(dir);
assert.strictEqual(packed.buffer.slice(0, 2).toString("latin1"), "PK", "нет сигнатуры ZIP");
assert.ok(packed.buffer.length > 50, "архив подозрительно пуст");
packed.cleanup();

const file = readLocalFile(path.join(dir, "index.js"));
assert.strictEqual(file.name, "index.js");
assert.match(file.buffer.toString("utf8"), /demo/);

assert.throws(() => zipLocalDir(path.join(dir, "нет-такой-папки")), /не найдена/);
assert.throws(() => readLocalFile(path.join(dir, "нет-такого-файла")), /не найден/);
assert.ok(TOOLS.some((t) => t.name === "upload_material"), "инструмент upload_material не зарегистрирован");

fs.rmSync(dir, { recursive: true, force: true });
console.log("OK: упаковка папки и чтение файла работают");
