"use strict";
// SPA-логика платформы: hash-роутинг + экраны. Использует window.UI.
// Обёрнуто в IIFE, чтобы имена не конфликтовали с global scope (см. ui.js).
(function () {
const { esc, el, api, toast, badge, progressBar, copy } = window.UI;
const app = document.getElementById("app");

// ---------- роутер ----------
const routes = [
  { rx: /^#?\/?$/, view: viewDashboard },
  { rx: /^#\/about$/, view: viewAbout },
  { rx: /^#\/p\/([^/]+)\/checks$/, view: (m) => viewChecks(m[1]) },
  { rx: /^#\/p\/([^/]+)\/tracker$/, view: (m) => viewTracker(m[1]) },
  { rx: /^#\/p\/([^/]+)\/docs$/, view: (m) => viewDocs(m[1]) },
  { rx: /^#\/p\/([^/]+)\/submit$/, view: (m) => viewSubmit(m[1]) },
  { rx: /^#\/p\/([^/]+)$/, view: (m) => viewProduct(m[1]) },
];

async function router() {
  const hash = location.hash || "#/";
  for (const r of routes) {
    const m = hash.match(r.rx);
    if (m) {
      app.innerHTML = '<div class="muted">Загрузка…</div>';
      try { await r.view(m); }
      catch (e) { app.innerHTML = `<div class="panel"><h2>Ошибка</h2><p class="mono">${esc(e.message || e)}</p></div>`; }
      return;
    }
  }
  app.innerHTML = '<div class="panel"><h2>Страница не найдена</h2><a href="#/">← к продуктам</a></div>';
}
window.addEventListener("hashchange", router);
// Надёжный старт: если DOM уже готов к моменту выполнения — рендерим сразу.
if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", router);
else router();

// Тихий автозапуск проверок (после сохранения карточки / загрузки артефакта).
async function runChecksSilent(id) {
  try { await api.post(`/api/products/${id}/checks`); }
  catch (e) { /* артефактов может не быть — проверки дадут SKIP, это не ошибка */ }
}

function crumbs(items) {
  return el("div", { class: "crumbs", html: items.map((i) =>
    i.href ? `<a href="${esc(i.href)}">${esc(i.text)}</a>` : esc(i.text)).join(" / ") });
}
function tabs(id, active) {
  const items = [
    { k: "", t: "Карточка" }, { k: "/checks", t: "Проверки" },
    { k: "/tracker", t: "Трекер" }, { k: "/docs", t: "Документы" },
    { k: "/submit", t: "Отправка" },
  ];
  return el("div", { class: "row", style: "margin-bottom:14px;gap:8px" },
    items.map((it) => {
      const href = `#/p/${id}${it.k}`;
      const cls = "btn" + (active === it.k ? "" : " ghost");
      return el("a", { class: cls, href }, it.t);
    }));
}

// Сворачиваемый блок-инструкция: <details class="help"> с заголовком и телом.
function help(summaryText, bodyNodes) {
  return el("details", { class: "help" }, [
    el("summary", {}, summaryText),
    el("div", { class: "body" }, bodyNodes),
  ]);
}
// Строка с командой и кнопкой «Копировать» (использует UI.copy).
function cmdBlock(text) {
  return el("div", { class: "cmd" }, [
    el("code", {}, text),
    el("button", { class: "ghost", onclick: async () => {
      const ok = await copy(text); toast(ok ? "Команда скопирована" : "Не удалось скопировать", !ok);
    } }, "Копировать"),
  ]);
}

// Скачивание сгенерированного текста как файла (скрипт подготовки).
function downloadText(name, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Конфигурация ОС для Мастера подготовки. Всё делается через git + npx (ставить ничего не нужно).
const OS_CFG = {
  win:   { label: "Windows (PowerShell)", file: "prepare.ps1", sep: "\\", eol: "\r\n",
           hash: (p) => `certutil -hashfile ${p} SHA256`,
           run: "В папке со скриптом: правой кнопкой → «Открыть в терминале», затем выполните команду ниже." },
  linux: { label: "Linux (Astra / РЕД / Alt)", file: "prepare.sh", sep: "/", eol: "\n",
           hash: (p) => `sha256sum ${p}`,
           run: "В папке со скриптом откройте терминал и выполните команду ниже." },
  mac:   { label: "macOS", file: "prepare.sh", sep: "/", eol: "\n",
           hash: (p) => `shasum -a 256 ${p}`,
           run: "В папке со скриптом откройте Терминал и выполните команду ниже." },
};
function detectOS() {
  const s = (navigator.userAgent + " " + (navigator.platform || "")).toLowerCase();
  if (s.includes("win")) return "win";
  if (s.includes("mac")) return "mac";
  return "linux";
}
// Команда запуска скрипта после скачивания.
function runCmd(os) {
  return os === "win" ? "powershell -ExecutionPolicy Bypass -File .\\prepare.ps1" : "bash prepare.sh";
}
// Отдельные команды подготовки (для тех, кто идёт по шагам вручную).
function prepSteps(os, repo) {
  const R = repo || "<ССЫЛКА_НА_РЕПОЗИТОРИЙ>";
  if (os === "win") return [
    ["Склонировать репозиторий", `git clone --depth 1 ${R} src`],
    ["Чистый снимок версии (ZIP, без node_modules/.git)", "git -C src archive --format=zip -o snapshot.zip HEAD"],
    ["Отпечаток SHA-256 (значение впишется в акт)", "certutil -hashfile snapshot.zip SHA256"],
    ["SBOM — список библиотек и лицензий", "npx --yes @cyclonedx/cdxgen@latest -o sbom.json src"],
  ];
  const hash = os === "mac" ? "shasum -a 256 snapshot.zip" : "sha256sum snapshot.zip";
  return [
    ["Склонировать репозиторий", `git clone --depth 1 ${R} src`],
    ["Чистый снимок версии (ZIP, без node_modules/.git)", "git -C src archive --format=zip -o snapshot.zip HEAD"],
    ["Отпечаток SHA-256 (значение впишется в акт)", hash],
    ["SBOM — список библиотек и лицензий", "npx --yes @cyclonedx/cdxgen@latest -o sbom.json src"],
  ];
}
// Полный скрипт «сделать всё сам»: клон → снимок → SHA-256 → SBOM в папку registry-artifacts.
function prepScript(os, repo) {
  const R = repo || "<ССЫЛКА_НА_РЕПОЗИТОРИЙ>";
  if (os === "win") return [
    "# Подготовка артефактов для реестра российского ПО",
    "$ErrorActionPreference = 'Stop'",
    "$repo = '" + R + "'",
    "$out = Join-Path (Get-Location) 'registry-artifacts'",
    "New-Item -ItemType Directory -Force -Path $out | Out-Null",
    "",
    "Write-Host '1/4 Клонирую репозиторий...'",
    'git clone --depth 1 $repo "$out\\src"',
    "",
    "Write-Host '2/4 Чистый снимок версии (ZIP)...'",
    'git -C "$out\\src" archive --format=zip -o "$out\\snapshot.zip" HEAD',
    "",
    "Write-Host '3/4 Считаю SHA-256...'",
    'certutil -hashfile "$out\\snapshot.zip" SHA256 | Out-File -Encoding utf8 "$out\\sha256.txt"',
    "",
    "Write-Host '4/4 Генерирую SBOM...'",
    'npx --yes @cyclonedx/cdxgen@latest -o "$out\\sbom.json" "$out\\src"',
    "",
    "Write-Host ''",
    'Write-Host "Готово! Файлы в папке: $out"',
    'Write-Host "  sbom.json    -> загрузить как SBOM"',
    'Write-Host "  snapshot.zip -> загрузить в Снимок версии кода"',
    'Write-Host "  sha256.txt   -> отпечаток для акта фиксации"',
  ].join("\r\n");
  const hash = os === "mac" ? "shasum -a 256" : "sha256sum";
  return [
    "#!/usr/bin/env bash",
    "# Подготовка артефактов для реестра российского ПО",
    "set -e",
    "repo='" + R + "'",
    'out="$(pwd)/registry-artifacts"',
    'mkdir -p "$out"',
    "",
    'echo "1/4 Клонирую репозиторий..."',
    'git clone --depth 1 "$repo" "$out/src"',
    "",
    'echo "2/4 Чистый снимок версии (ZIP)..."',
    'git -C "$out/src" archive --format=zip -o "$out/snapshot.zip" HEAD',
    "",
    'echo "3/4 Считаю SHA-256..."',
    hash + ' "$out/snapshot.zip" > "$out/sha256.txt"',
    "",
    'echo "4/4 Генерирую SBOM..."',
    'npx --yes @cyclonedx/cdxgen@latest -o "$out/sbom.json" "$out/src"',
    "",
    'echo ""',
    'echo "Готово! Файлы в папке: $out"',
    'echo "  sbom.json    -> загрузить как SBOM"',
    'echo "  snapshot.zip -> загрузить в Снимок версии кода"',
    'echo "  sha256.txt   -> отпечаток для акта фиксации"',
  ].join("\n");
}

// Мастер подготовки: ссылка на репозиторий + ОС → скрипт «всё сам» и/или команды по шагам.
function prepWizard() {
  const state = { repo: "", os: detectOS() };
  const out = el("div", { style: "margin-top:12px" });

  const repoInp = el("input", { type: "text", value: "",
    placeholder: "https://github.com/ваша-компания/ваш-продукт.git" });
  repoInp.addEventListener("input", () => { state.repo = repoInp.value.trim(); render(); });

  const osSel = el("select", {}, Object.entries(OS_CFG).map(([k, c]) =>
    el("option", { value: k, ...(k === state.os ? { selected: "selected" } : {}) }, c.label)));
  osSel.addEventListener("change", () => { state.os = osSel.value; render(); });

  function render() {
    const cfg = OS_CFG[state.os];
    const script = prepScript(state.os, state.repo);
    out.innerHTML = "";

    const dlBtn = el("button", { onclick: () => {
      if (!state.repo) { toast("Сначала вставьте ссылку на репозиторий", true); return; }
      downloadText(cfg.file, script); toast(`Скрипт ${cfg.file} скачан`);
    } }, `⬇ Скачать скрипт (${cfg.file})`);

    const stepsRows = prepSteps(state.os, state.repo).map(([label, cmd], i) =>
      el("div", { style: "margin:8px 0" }, [
        el("div", { class: "mono", style: "margin-bottom:2px" }, `${i + 1}. ${label}`),
        cmdBlock(cmd),
      ]));

    out.append(
      el("div", { class: "row", style: "align-items:center;gap:10px;margin-bottom:6px" }, [
        dlBtn,
        el("span", { class: "muted", style: "font-size:12px" }, cfg.run),
      ]),
      cmdBlock(runCmd(state.os)),
      el("div", { class: "hint", html:
        "После запуска в папке <span class='mono'>registry-artifacts</span> появятся: " +
        "<b>sbom.json</b> (→ загрузить как SBOM ниже), <b>snapshot.zip</b> (→ «Снимок версии кода»), " +
        "<b>sha256.txt</b> (отпечаток для акта). Затем нажмите «Сгенерировать» у акта фиксации." }),
      help("🧰 Нет git или Node.js? / Показать команды по шагам", [
        el("div", { html:
          "Скрипт использует два инструмента (обычно уже есть у разработчика):" }),
        el("ul", { html:
          "<li><b>Git</b> — <a href='https://git-scm.com/downloads' target='_blank' rel='noopener'>git-scm.com/downloads</a></li>" +
          "<li><b>Node.js</b> (даёт команду <span class='mono'>npx</span>) — " +
          "<a href='https://nodejs.org/' target='_blank' rel='noopener'>nodejs.org</a></li>" }),
        el("div", { class: "muted", style: "margin-top:8px" },
          "Если не хотите запускать скрипт — выполните эти команды по очереди в пустой папке:"),
        ...stepsRows,
      ]),
    );
  }
  render();

  return el("div", { class: "panel" }, [
    el("h2", {}, "🧙 Мастер подготовки — собрать файлы автоматически"),
    el("div", { class: "hint", html:
      "Вставьте ссылку на репозиторий и выберите вашу систему — платформа даст готовый скрипт " +
      "и точные команды под вашу ОС. Скрипт сам склонирует код, сделает чистый снимок версии, " +
      "посчитает SHA-256 и соберёт SBOM." }),
    el("div", { class: "two-col" }, [
      el("label", { class: "field" }, [el("span", { style: "display:block;margin-bottom:4px" }, "Ссылка на репозиторий (Git)"), repoInp]),
      el("label", { class: "field" }, [el("span", { style: "display:block;margin-bottom:4px" }, "Ваша операционная система"), osSel]),
    ]),
    out,
  ]);
}

// Инструкции по получению артефактов и ключевые условия — единый источник для UI.
function harHelp() {
  return help("🌐 Как получить HAR — запись сетевых обращений продукта", [
    el("div", { html:
      "<b>Что это.</b> Запись того, куда ваш продукт реально ходит в сети. Платформа ищет обращения " +
      "<b>за рубеж</b> (Google Fonts, зарубежные CDN, иностранная аналитика/облака) — это стоп-фактор." }),
    el("div", { html:
      "<b>Кто делает.</b> Вы сами — нужен только браузер <b>Chrome или Edge</b>, устанавливать ничего не надо." }),
    el("ol", { html:
      "<li>Откройте <b>работающий</b> продукт в браузере.</li>" +
      "<li>Нажмите <b>F12</b> — откроется панель разработчика.</li>" +
      "<li>Вверху выберите вкладку <b>Network</b> (Сеть).</li>" +
      "<li>Поставьте галочку <b>Preserve log</b> (сохранять лог).</li>" +
      "<li>Нажмите <b>F5</b> и покликайте по основным экранам продукта.</li>" +
      "<li>Правой кнопкой в списке запросов → <b>Save all as HAR</b> → сохранится файл <span class='mono'>.har</span>.</li>" +
      "<li>Загрузите его кнопкой «Загрузить HAR» выше.</li>" }),
    el("div", { class: "muted", html:
      "Файл-пример для пробы: <span class='mono'>02_checks/samples/network.sample.har</span>." }),
  ]);
}
function conditionsHelp() {
  return help("❗ Ключевые условия и стоп-факторы входа в реестр", [
    el("ul", { html:
      "<li><b>Правообладатель</b> — российское юрлицо, суммарный контроль РФ &gt; 50%.</li>" +
      "<li><b>Выплаты иностранцам</b> за права на ПО — строго &lt; 30% выручки по продукту.</li>" +
      "<li><b>Интерфейс — на русском</b> языке (английский GUI — стоп-фактор).</li>" +
      "<li><b>Нет обращений за рубеж</b> в работе продукта (CDN, аналитика, облака).</li>" +
      "<li><b>Без санкционных СУБД</b>: Oracle, MS SQL Server, SAP HANA → PostgreSQL и аналоги.</li>" +
      "<li><b>Инфраструктура и CI/CD</b> — в РФ (не AWS/Azure/GitLab.com).</li>" +
      "<li><b>Лицензии OSS</b> — без GPL/AGPL в ядре, без компонентов «без лицензии».</li>" +
      "<li>С 2026 г. — поддержка <b>≥ 2 российских ОС</b> (Astra Linux, РЕД ОС, Alt) <span class='tag'>СВЕРИТЬ для класса</span>.</li>" +
      "<li><b>Страница продукта</b> на РФ-хостинге + контакты техподдержки в РФ.</li>" }),
    el("div", { class: "muted", html:
      "Финансовый критерий (30%), лицензии, сетевой аудит и страницу проверяет вкладка «Проверки». " +
      "Остальное отмечается вручную в «Трекере» (гейты G0–G5)." }),
  ]);
}
function codefragHelp() {
  return help("📄 Как получить фрагмент исходного кода (до 70 страниц)", [
    el("div", { html:
      "<b>Что это.</b> Для Роспатента депонируется не весь код, а <b>реферат + фрагмент листинга</b>. " +
      "Объём фрагмента — <b>не более 70 страниц</b>." }),
    el("ol", { html:
      "<li>Если код небольшой (≤70 стр.) — включите его целиком.</li>" +
      "<li>Если кода много — по правилу Роспатента берут <b>первые 35 и последние 35 страниц</b> листинга " +
      "(итого ≤70). Включайте значимые модули: точку входа и ключевую логику.</li>" +
      "<li>Соберите в один документ моноширинным шрифтом, с нумерацией страниц.</li>" +
      "<li>На титуле укажите название программы и правообладателя.</li>" +
      "<li>Сохраните в <b>PDF</b> (или DOCX) и загрузите кнопкой «Загрузить файл».</li>" }),
    el("div", { class: "muted", html:
      "Быстро собрать листинг в один текстовый файл (Windows, PowerShell) — затем распечатать его в PDF:" }),
    cmdBlock('Get-ChildItem -Recurse -Include *.js,*.ts,*.py | Get-Content | Out-File listing.txt'),
  ]);
}

// Справочник официальных классов ПО (сворачиваемый), с источником и датой сверки.
function classesReference(ref) {
  if (!ref || !Array.isArray(ref.classes) || !ref.classes.length) return null;
  const rows = ref.classes.map((c) => el("tr", {}, [
    el("td", { class: "mono", style: "width:1%;white-space:nowrap" }, c.code),
    el("td", {}, c.name),
  ]));
  return help("📚 Классификатор ПО — официальные классы (СВЕРИТЬ подкласс)", [
    el("div", { class: "muted", style: "margin-bottom:6px", html:
      `Источник: <b>${esc(ref.source || "—")}</b>. Сверено: ${esc(ref.verifiedAt || "—")}. ` +
      "Ниже — верхнеуровневые классы. Точный <b>подкласс</b> (например 05.09) и его формулировку " +
      "сверьте на <span class='mono'>reestr.digital.gov.ru</span> перед подачей." }),
    el("table", {}, [el("tr", {}, [el("th", {}, "Код"), el("th", {}, "Класс")]), ...rows]),
  ]);
}

// ---------- дашборд ----------
async function viewDashboard() {
  const { products } = await api.get("/api/products");
  const head = el("div", { class: "row", style: "align-items:center;margin-bottom:16px" }, [
    el("h2", { style: "margin:0;color:var(--blue);flex:1" }, `Продукты (${products.length})`),
    el("button", { onclick: createProduct }, "+ Новый продукт"),
  ]);

  const grid = el("div", { class: "grid" }, products.map((p) => {
    const card = el("div", { class: "card", onclick: () => (location.hash = `#/p/${p.id}`) }, [
      el("div", { class: "name" }, p.name),
      el("div", { class: "meta" }, `${p.shortName || "—"} · ${p.deliveryType || "—"}`),
      progressBar(p.percent),
      el("div", { class: "meta", html: `Готовность: <b>${p.percent}%</b> · Проверки: ${badge(p.checksOverall)}` }),
    ]);
    return card;
  }));

  const empty = products.length ? null :
    el("div", { class: "hint" }, "Продуктов пока нет. Создайте первый — карточка заполнится из шаблона product.example.json.");

  app.innerHTML = "";
  app.append(head, empty || grid);
}

async function createProduct() {
  const name = prompt("Название продукта:", "Новый продукт");
  if (!name) return;
  const { id } = await api.post("/api/products", { name });
  toast("Продукт создан");
  location.hash = `#/p/${id}`;
}

// ---------- карточка продукта ----------
async function viewProduct(id) {
  const { product } = await api.get(`/api/products/${id}`);
  // Справочник классов ПО (официальный классификатор). Не критичен — при ошибке просто нет автоподсказок.
  const classesRef = await api.get("/api/reference/classes").catch(() => null);
  const p = product.product || {};
  const rh = product.rightholder || {};
  const f = product.finance || {};
  const t = product.tech || {};
  const s = product.support || {};

  // Плоские поля для формы: [путь, подпись, тип, подсказка?]
  const fields = [
    ["product.name", "Наименование", "text"],
    ["product.shortName", "Короткое имя", "text"],
    ["product.deliveryType", "Модель поставки", "select:SaaS,on-prem,hybrid"],
    ["product.guiLanguage", "Язык интерфейса", "select:ru,en"],
    ["product.productPageUrl", "URL страницы продукта", "text"],
    ["product.class", "Класс(ы) ПО", "classpicker", "выберите класс из официального списка · подкласс СВЕРИТЬ"],
    ["product.description", "Описание функциональных характеристик", "textarea"],
    ["product.purpose", "Назначение / область применения", "textarea"],
    ["rightholder.orgName", "Правообладатель", "text"],
    ["rightholder.inn", "ИНН", "text"],
    ["rightholder.ogrn", "ОГРН", "text"],
    ["rightholder.ruControlSharePercent", "Доля РФ-контроля, %", "number"],
    ["rights.basis", "Основание прав", "select:rospatent,internal_docs"],
    ["rights.rospatentCertificateNumber", "№ свидетельства Роспатента", "text", "заполнить после регистрации"],
    ["rights.rospatentCertificateDate", "Дата свидетельства (ГГГГ-ММ-ДД)", "text"],
    ["rights.authors", "Авторы (ФИО через запятую)", "list", "для реферата и цепочки прав"],
    ["product.programmingLanguages", "Языки программирования (через запятую)", "list"],
    ["finance.annualRevenueProduct", "Выручка по продукту за год", "number"],
    ["finance.annualForeignPayments", "Выплаты иностранцам за год", "number"],
    ["tech.supportedOS", "Поддерживаемые ОС", "multi:Astra Linux|РЕД ОС|Alt Linux|ROSA|МСВСфера|Windows"],
    ["tech.databases", "СУБД", "multi:PostgreSQL|Postgres Pro|ClickHouse|YDB|Tarantool|Ред База Данных|встроенная (SQLite/файловая)|не используется"],
    ["tech.infraLocation", "Локация инфраструктуры", "select:RU,иное"],
    ["support.contactsRu", "Контакты ТП (РФ)", "text"],
  ];

  function getVal(pathStr) {
    return pathStr.split(".").reduce((o, k) => (o == null ? o : o[k]), product);
  }
  function setVal(pathStr, val) {
    const keys = pathStr.split(".");
    let o = product;
    for (let i = 0; i < keys.length - 1; i++) { o[keys[i]] = o[keys[i]] || {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = val;
  }

  const form = el("div", { class: "two-col" }, fields.map(([pathStr, label, type, hint]) => {
    const cur = getVal(pathStr);
    let input, extra = null, labelStyle = "";
    if (type.startsWith("select:")) {
      const opts = type.slice(7).split(",");
      input = el("select", { "data-path": pathStr },
        opts.map((o) => el("option", { value: o, ...(o === cur ? { selected: "selected" } : {}) }, o)));
    } else if (type.startsWith("datalist:")) {
      const listId = "dl-" + pathStr.replace(/\W/g, "");
      const opts = type.slice(9).split("|");
      extra = el("datalist", { id: listId }, opts.map((o) => el("option", { value: o })));
      input = el("input", { type: "text", "data-path": pathStr, "data-list": "1", list: listId,
        value: Array.isArray(cur) ? cur.join(", ") : (cur || "") });
    } else if (type === "classpicker") {
      // Официальный классификатор: подсказка «код — название», в поле сохраняется код.
      // Несколько классов — через запятую. Подкласс (NN.NN) вписывается вручную.
      const listId = "dl-class";
      const list = (classesRef && classesRef.classes) || [];
      extra = el("datalist", { id: listId }, list.map((c) =>
        el("option", { value: c.code }, `${c.code} — ${c.name}`)));
      input = el("input", { type: "text", "data-path": pathStr, "data-list": "1", list: listId,
        placeholder: "напр. 05 или 05.09 — начните вводить код",
        value: Array.isArray(cur) ? cur.join(", ") : (cur || "") });
    } else if (type.startsWith("multi:")) {
      // Мультивыбор: чекбоксы по вариантам + поле «другое» для значений вне списка.
      labelStyle = "grid-column:1 / -1";
      const opts = type.slice(6).split("|");
      const curArr = Array.isArray(cur) ? cur : (cur ? [cur] : []);
      const known = new Set(opts);
      const boxes = opts.map((o) => el("label", { class: "chk" },
        [el("input", { type: "checkbox", value: o, ...(curArr.includes(o) ? { checked: "checked" } : {}) }), el("span", {}, o)]));
      const extraInp = el("input", { type: "text", class: "multi-extra", placeholder: "другое, через запятую",
        value: curArr.filter((v) => !known.has(v)).join(", ") });
      input = el("div", { class: "multi", "data-path": pathStr, "data-multi": "1" }, [...boxes, extraInp]);
    } else if (type === "textarea") {
      labelStyle = "grid-column:1 / -1";
      input = el("textarea", { "data-path": pathStr }, cur == null ? "" : String(cur));
    } else if (type === "list") {
      input = el("input", { type: "text", "data-path": pathStr, "data-list": "1",
        value: Array.isArray(cur) ? cur.join(", ") : (cur || "") });
    } else {
      input = el("input", { type: type === "number" ? "number" : "text", "data-path": pathStr,
        value: cur == null ? "" : cur });
    }
    const spanKids = [el("span", {}, label)];
    if (hint) spanKids.push(el("span", { class: "tag" }, hint));
    return el("label", { class: "field", style: labelStyle },
      [el("span", { style: "display:block;margin-bottom:4px" }, spanKids), input, extra]);
  }));

  async function save() {
    app.querySelectorAll("[data-path]").forEach((inp) => {
      let v;
      if (inp.getAttribute("data-multi")) {
        const checked = Array.from(inp.querySelectorAll("input[type=checkbox]")).filter((c) => c.checked).map((c) => c.value);
        const extra = inp.querySelector(".multi-extra");
        const extraVals = extra && extra.value ? extra.value.split(",").map((x) => x.trim()).filter(Boolean) : [];
        v = [...checked, ...extraVals];
      } else if (inp.getAttribute("data-list")) {
        v = inp.value.split(",").map((x) => x.trim()).filter(Boolean);
      } else if (inp.type === "number") {
        v = inp.value === "" ? null : Number(inp.value);
      } else {
        v = inp.value;
      }
      setVal(inp.getAttribute("data-path"), v);
    });
    await api.put(`/api/products/${id}`, { product });
    await runChecksSilent(id);
    toast("Сохранено, проверки обновлены");
  }

  // Артефакты
  const { artifacts } = await api.get(`/api/products/${id}/artifacts`);
  // В панели проверок показываем только SBOM/HAR; документы депонирования (dep_/rights_) — в своём разделе.
  const checkArtifacts = artifacts.filter((a) => !/^(dep_|rights_)/i.test(a.name));
  const artList = el("div", {}, checkArtifacts.length
    ? checkArtifacts.map((a) => el("div", { class: "meta mono" }, `• ${a.name} (${a.size} б)`))
    : [el("div", { class: "muted" }, "нет загруженных артефактов")]);

  // kind: sbom|har запускают проверки; rights (правоустанавливающие) — просто хранятся.
  function uploader(kind, label, accept) {
    const acc = accept || (kind === "sbom" ? ".json" : ".har,.json");
    const inp = el("input", { type: "file", style: "display:none", accept: acc });
    inp.addEventListener("change", async () => {
      const file = inp.files[0]; if (!file) return;
      const buf = await file.arrayBuffer();
      await api.putRaw(`/api/products/${id}/artifacts/${kind}?name=${encodeURIComponent(file.name)}`, buf);
      if (kind !== "rights") await runChecksSilent(id);
      toast(`${label} загружен`);
      viewProduct(id);
    });
    return el("span", {}, [
      el("button", { class: "ghost", onclick: () => inp.click() }, `Загрузить ${label}`), inp,
    ]);
  }

  // --- Трекер подготовки к депонированию (Роспатент) ---
  // Пункты: ключ (= префикс файлов), формулировка, допустимые форматы.
  // [ключ, подпись, форматы загрузки, genKind|null] — genKind: можно сгенерировать автоматически.
  const DEPON_ITEMS = [
    ["dep_snapshot",  "Снимок версии кода + акт фиксации (SHA-256)",      ".zip,.tar,.gz,.7z,.rar", "dep_snapshot"],
    ["dep_referat",   "Реферат программы",                                ".docx,.pdf,.txt", "dep_referat"],
    ["dep_codefrag",  "Фрагмент исходного кода (до 70 страниц)",          ".pdf,.docx", null],
    ["dep_chain",     "Цепочка прав: договоры, служебные задания, акты",  ".pdf,.zip,.docx", "dep_chain"],
    ["dep_statement", "Заявление в Роспатент, подписанное УКЭП",          ".pdf,.sig,.zip", "dep_statement"],
    ["dep_cert",      "Свидетельство о госрегистрации ПО",                ".pdf,.png,.jpg,.jpeg", null],
  ];

  async function genDepon(kind, btn) {
    btn.disabled = true; const t0 = btn.textContent; btn.textContent = "…";
    try {
      const res = await api.post(`/api/products/${id}/depon/${kind}`);
      toast(`Сгенерировано: ${res.generated.title}`);
      viewProduct(id);
    } catch (e) { toast(e.message || "Ошибка генерации", true); btn.disabled = false; btn.textContent = t0; }
  }

  const deponRows = DEPON_ITEMS.map(([key, label, accept, genKind]) => {
    const files = artifacts.filter((a) => a.name.toLowerCase().startsWith(key + "_"));
    const done = files.length > 0;
    const filesCell = files.length
      ? el("div", {}, files.map((a) => el("div", { class: "mono", style: "margin:1px 0" }, [
          el("a", { href: `/api/products/${id}/artifacts/file/${encodeURIComponent(a.name)}` },
            a.name.slice(key.length + 1)),
          el("a", { href: "#", style: "margin-left:8px;color:var(--fail)", onclick: async (e) => {
            e.preventDefault();
            if (confirm("Удалить файл?")) { await api.del(`/api/products/${id}/artifacts/${encodeURIComponent(a.name)}`); viewProduct(id); }
          } }, "×"),
        ])))
      : el("span", { class: "muted" }, "—");
    const actions = [uploader(key, "файл", accept)];
    if (genKind) {
      const gb = el("button", { class: "ghost", style: "margin-left:6px",
        onclick: () => genDepon(genKind, gb) }, "Сгенерировать");
      actions.push(gb);
    }
    return el("tr", {}, [
      el("td", { style: "width:1%;white-space:nowrap" }, done ? "✅" : "☐"),
      el("td", {}, label),
      el("td", { style: "width:26%" }, filesCell),
      el("td", { style: "width:1%;white-space:nowrap" }, el("div", { class: "row", style: "gap:4px;flex-wrap:nowrap" }, actions)),
    ]);
  });
  const deponDone = DEPON_ITEMS.filter(([key]) => artifacts.some((a) => a.name.toLowerCase().startsWith(key + "_"))).length;

  // Черновик реферата из карточки (свёрнут; для копирования при оформлении).
  const referat = [
    "РЕФЕРАТ программы для ЭВМ", "",
    `Название программы: ${p.name || "—"}`,
    `Правообладатель: ${rh.orgName || "—"} (ИНН ${rh.inn || "—"}, ОГРН ${rh.ogrn || "—"})`,
    "Авторы: — ФИО разработчиков —",
    "Язык программирования: — указать —",
    `Операционные системы: ${(Array.isArray(t.supportedOS) ? t.supportedOS.join(", ") : t.supportedOS) || "—"}`,
    "Объём программы: — напр. 12 МБ —", "",
    "Аннотация:", p.description || "— функциональные характеристики —", "",
    `Назначение: ${p.purpose || "— область применения —"}`,
    "Графический интерфейс — на русском языке.",
  ].join("\n");
  const referatBox = el("textarea", { readonly: "readonly",
    style: "width:100%;min-height:180px;font-family:Consolas,monospace;font-size:12px" }, referat);
  const referatDraft = help("✍ Черновик реферата — скопировать и оформить в .docx", [
    referatBox,
    el("div", { class: "row", style: "margin-top:6px" }, [
      el("button", { class: "ghost", onclick: async () => {
        const ok = await copy(referat); toast(ok ? "Скопировано" : "Не удалось скопировать", !ok);
      } }, "Копировать"),
    ]),
  ]);

  app.innerHTML = "";
  app.append(
    crumbs([{ text: "Продукты", href: "#/" }, { text: p.name || id }]),
    tabs(id, ""),
    el("div", { class: "panel" }, [
      el("h2", {}, "Карточка продукта"),
      form,
      el("div", { class: "row", style: "margin-top:8px" }, [
        el("button", { onclick: save }, "Сохранить"),
        el("button", { class: "danger", onclick: async () => {
          if (confirm("Удалить продукт со всеми данными?")) { await api.del(`/api/products/${id}`); location.hash = "#/"; }
        } }, "Удалить"),
      ]),
      classesReference(classesRef),
    ]),
    prepWizard(),
    el("div", { class: "panel" }, [
      el("h2", {}, "Артефакты для проверок"),
      el("div", { class: "hint", html: "Загрузите два файла из вашего продукта — по ним пройдут проверки лицензий и сетевого аудита (гейт G3). <b>SBOM</b> собирает «Мастер подготовки» выше; <b>HAR</b> снимается в браузере (см. ниже)." }),
      el("div", { class: "row", style: "gap:8px" }, [uploader("sbom", "SBOM"), uploader("har", "HAR")]),
      el("div", { class: "spacer" }), artList,
      el("div", { class: "spacer" }),
      harHelp(),
    ]),
    el("div", { class: "panel" }, [
      el("div", { class: "row", style: "align-items:center;margin-bottom:8px" }, [
        el("h2", { style: "flex:1;margin:0" }, "Подготовка к депонированию (Роспатент)"),
        el("span", { class: "muted" }, `Готово: ${deponDone}/${DEPON_ITEMS.length}`),
      ]),
      el("table", {}, [
        el("tr", {}, [el("th", {}, ""), el("th", {}, "Документ"), el("th", {}, "Файлы"), el("th", {}, "")]),
        ...deponRows,
      ]),
      el("div", { class: "spacer" }),
      el("div", { class: "muted", style: "font-size:12px" },
        "Снимок версии кода и SHA-256 готовит «Мастер подготовки» вверху страницы."),
      codefragHelp(),
      referatDraft,
    ]),
    el("div", { class: "panel" }, [
      el("h2", {}, "Ключевые условия входа в реестр"),
      conditionsHelp(),
    ]),
  );
}

// ---------- проверки ----------
async function viewChecks(id) {
  const { product } = await api.get(`/api/products/${id}`);
  const name = (product.product && product.product.name) || id;
  const { report } = await api.get(`/api/products/${id}/report`);

  app.innerHTML = "";
  app.append(crumbs([{ text: "Продукты", href: "#/" }, { text: name, href: `#/p/${id}` }, { text: "Проверки" }]), tabs(id, "/checks"));

  const runBtn = el("button", { onclick: run }, "▶ Запустить проверки");
  const panel = el("div", { class: "panel" }, [
    el("div", { class: "row", style: "align-items:center" }, [
      el("h2", { style: "flex:1;margin:0" }, "Технические проверки готовности"), runBtn,
    ]),
    el("div", { class: "muted", style: "margin:4px 0 8px;font-size:12px" },
      "Обновляются автоматически при сохранении карточки и загрузке артефактов. Кнопка — для ручного перезапуска."),
    el("div", { id: "checks-body" }),
  ]);
  app.append(panel);
  renderReport(report);

  async function run() {
    runBtn.disabled = true; runBtn.textContent = "Выполняется…";
    try {
      const res = await api.post(`/api/products/${id}/checks`);
      toast("Проверки выполнены");
      renderReport(res.report);
    } finally { runBtn.disabled = false; runBtn.textContent = "▶ Запустить проверки"; }
  }

  function renderReport(rep) {
    const body = document.getElementById("checks-body");
    body.innerHTML = "";
    if (!rep) { body.append(el("div", { class: "muted" }, "Проверки ещё не запускались.")); return; }
    body.append(el("div", { class: "row", style: "margin:8px 0", html:
      `Итог: ${badge(rep.overall)} &nbsp; <span class="muted">PASS ${rep.totals.PASS} · WARN ${rep.totals.WARN} · FAIL ${rep.totals.FAIL} · SKIP ${rep.totals.SKIP}</span>` }));
    rep.results.forEach((r) => {
      const rows = (r.findings || []).map((f) => {
        const obj = f.host || f.component || f.metric || f.field || "";
        const note = [f.note, f.license ? `лицензия: ${f.license}` : ""].filter(Boolean).join("; ");
        return el("tr", {}, [
          el("td", { html: badge(f.severity) }),
          el("td", { class: "mono" }, obj),
          el("td", {}, note),
        ]);
      });
      const table = rows.length ? el("table", {}, [
        el("tr", {}, [el("th", {}, "Уровень"), el("th", {}, "Объект"), el("th", {}, "Замечание")]),
        ...rows,
      ]) : null;
      body.append(el("div", { class: "panel", style: "margin:10px 0;background:#fbfcfe" }, [
        el("div", { html: `${badge(r.status)} <b>${esc(r.title)}</b>` }),
        el("div", { class: "muted", style: "margin:6px 0" }, r.summary),
        table,
      ]));
    });
  }
}

// ---------- трекер ----------
async function viewTracker(id) {
  const { product } = await api.get(`/api/products/${id}`);
  const name = (product.product && product.product.name) || id;
  const { tracker } = await api.get(`/api/products/${id}/tracker`);

  app.innerHTML = "";
  app.append(crumbs([{ text: "Продукты", href: "#/" }, { text: name, href: `#/p/${id}` }, { text: "Трекер" }]), tabs(id, "/tracker"));

  const overall = el("div", { class: "panel" }, [
    el("div", { class: "row", style: "align-items:center", html:
      `<h2 style="flex:1;margin:0">Готовность: ${tracker.percent}%</h2>` +
      `<span class="muted">${tracker.done}/${tracker.total} пунктов · проверки: ${badge(tracker.checksOverall)}</span>` }),
    progressBar(tracker.percent),
  ]);
  app.append(overall);

  tracker.gates.forEach((g) => {
    const items = g.items.map((it) => {
      const cb = el("input", { type: "checkbox", ...(it.done ? { checked: "checked" } : {}),
        ...(g.auto ? { disabled: "disabled" } : {}) });
      if (!g.auto) cb.addEventListener("change", async () => {
        await api.put(`/api/products/${id}/tracker`, { items: { [it.id]: cb.checked } });
        toast("Отмечено"); viewTracker(id);
      });
      return el("label", { class: "item" + (g.auto ? " auto" : "") }, [
        cb, el("span", {}, it.text),
        g.auto ? el("span", { class: "auto-tag" }, "из проверок") : null,
      ]);
    });
    app.append(el("div", { class: "gate" }, [
      el("div", { class: "head", html:
        `<span class="gid">${esc(g.id)}</span> <span>${esc(g.title)}</span>` +
        `<span class="pct">${g.done}/${g.total}${g.auto ? " · авто" : ""}</span>` }),
      el("div", { class: "items" }, items),
    ]));
  });

  if (!tracker.hasReport) app.append(el("div", { class: "hint" },
    "Гейт G3 заполнится после запуска проверок на вкладке «Проверки»."));
}

// ---------- документы ----------
async function viewDocs(id) {
  const { product } = await api.get(`/api/products/${id}`);
  const name = (product.product && product.product.name) || id;
  const { docs } = await api.get(`/api/products/${id}/dossier`);

  app.innerHTML = "";
  app.append(crumbs([{ text: "Продукты", href: "#/" }, { text: name, href: `#/p/${id}` }, { text: "Документы" }]), tabs(id, "/docs"));

  const genBtn = el("button", { onclick: gen }, "📄 Сгенерировать досье");
  const list = el("div", { id: "docs-list" });
  app.append(el("div", { class: "panel" }, [
    el("div", { class: "row", style: "align-items:center" }, [
      el("h2", { style: "flex:1;margin:0" }, "Пакет досье (.docx)"), genBtn,
    ]),
    el("div", { class: "hint" }, "Документы — предзаполненные каркасы из карточки. Правовые формулировки проверяет юрист/бухгалтер правообладателя."),
    list,
  ]));
  renderDocs(docs);

  async function gen() {
    genBtn.disabled = true; genBtn.textContent = "Генерация…";
    try {
      const res = await api.post(`/api/products/${id}/dossier`);
      toast("Досье сгенерировано");
      renderDocs(res.docs.map((d) => ({ name: d.name, size: d.bytes })));
    } finally { genBtn.disabled = false; genBtn.textContent = "📄 Сгенерировать досье"; }
  }
  function renderDocs(items) {
    list.innerHTML = "";
    if (!items || !items.length) { list.append(el("div", { class: "muted" }, "Документы ещё не сгенерированы.")); return; }
    const rows = items.map((d) => el("tr", {}, [
      el("td", {}, el("a", { href: `/api/products/${id}/dossier/${encodeURIComponent(d.name)}` }, d.name)),
      el("td", { class: "muted" }, `${d.size || d.bytes || "?"} б`),
    ]));
    list.append(el("table", {}, [el("tr", {}, [el("th", {}, "Файл"), el("th", {}, "Размер")]), ...rows]));
  }
}

// ---------- отправка (монтажный лист подачи) ----------
async function viewSubmit(id) {
  const { submission } = await api.get(`/api/products/${id}/submission`);
  const S = submission;

  app.innerHTML = "";
  app.append(
    crumbs([{ text: "Продукты", href: "#/" }, { text: S.productName, href: `#/p/${id}` }, { text: "Отправка" }]),
    tabs(id, "/submit"),
  );

  app.append(el("div", { class: "hint", html:
    "Готовые значения для формы карточки ПО на <span class='mono'>reestr.digital.gov.ru</span>. " +
    "Копируй по полям и вставляй в портал. Значения с «СВЕРИТЬ» проверь перед подачей." }));

  // --- Что осталось за вами (агрегированный список действий человека) ---
  const acts = S.nextActions || [];
  const cmp = S.completeness || { percent: 0, filled: 0, total: 0 };
  if (acts.length) {
    // Группировка по area с сохранением порядка появления.
    const groups = [];
    const byArea = {};
    acts.forEach((a) => {
      if (!byArea[a.area]) { byArea[a.area] = []; groups.push(a.area); }
      byArea[a.area].push(a);
    });
    const groupNodes = groups.map((area) => el("div", { style: "margin:6px 0" }, [
      el("div", { class: "mono", style: "font-weight:600;margin-bottom:2px" }, area),
      el("ul", { style: "margin:2px 0" }, byArea[area].map((a) =>
        el("li", { style: "margin:2px 0" }, [
          el("a", { href: a.hash }, a.text),
        ]))),
    ]));
    app.append(el("div", { class: "panel", style: "border-left:4px solid var(--blue)" }, [
      el("div", { class: "row", style: "align-items:center" }, [
        el("h2", { style: "flex:1;margin:0" }, `Что осталось за вами (${acts.length})`),
        el("span", { class: "muted" }, `Карточка: ${cmp.filled}/${cmp.total} полей`),
      ]),
      el("div", { class: "muted", style: "font-size:12px;margin:4px 0 8px" },
        "Единый список действий: заполнить поля, загрузить артефакты, отметить ручные пункты. Клик — переход к нужной вкладке."),
      ...groupNodes,
    ]));
  } else {
    app.append(el("div", { class: "panel", style: "border-left:4px solid var(--pass, #2e7d32)" }, [
      el("div", { html: "✅ <b>Все отслеживаемые пункты закрыты.</b> Сверьте значения с «СВЕРИТЬ» и подавайте." }),
    ]));
  }

  // --- Поля для портала ---
  const copyBtn = (text) => el("button", { class: "ghost", onclick: async () => {
    const ok = await copy(text); toast(ok ? "Скопировано" : "Не удалось скопировать", !ok);
  } }, "Копировать");

  const fieldRows = S.fields.map((f) => el("tr", {}, [
    el("td", { style: "width:34%" }, [
      el("b", {}, f.portalLabel),
      f.note ? el("div", { class: "tag" }, f.note) : null,
    ]),
    el("td", { class: "mono", style: "white-space:pre-wrap" }, String(f.value)),
    el("td", { style: "width:1%" }, copyBtn(String(f.value))),
  ]));

  const copyAll = el("button", { onclick: async () => {
    const text = S.fields.map((f) => `${f.portalLabel}:\n${f.value}`).join("\n\n");
    const ok = await copy(text); toast(ok ? "Все поля скопированы" : "Не удалось", !ok);
  } }, "⧉ Копировать всё");

  app.append(el("div", { class: "panel" }, [
    el("div", { class: "row", style: "align-items:center" }, [
      el("h2", { style: "flex:1;margin:0" }, "Поля карточки ПО для портала"), copyAll,
    ]),
    el("table", {}, [
      el("tr", {}, [el("th", {}, "Поле на портале"), el("th", {}, "Значение"), el("th", {}, "")]),
      ...fieldRows,
    ]),
  ]));

  // --- Вложения ---
  const attRows = S.attachments.map((a) => {
    const status = a.ready ? "✅ готово" : (a.manual ? "☐ приложить вручную" : "— нет");
    const link = a.downloadName
      ? el("a", { href: `/api/products/${id}/dossier/${encodeURIComponent(a.downloadName)}` }, "скачать")
      : (a.note ? el("span", { class: "muted" }, a.note) : null);
    return el("tr", {}, [
      el("td", {}, a.label),
      el("td", { style: "width:22%" }, status),
      el("td", { style: "width:14%" }, link),
    ]);
  });
  app.append(el("div", { class: "panel" }, [
    el("h2", {}, "Документы к прикреплению"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:8px" },
      "«готово» — сформировано платформой; «вручную» — подготовить и приложить самостоятельно."),
    el("table", {}, [
      el("tr", {}, [el("th", {}, "Документ"), el("th", {}, "Статус"), el("th", {}, "")]),
      ...attRows,
    ]),
  ]));

  // --- Сценарий подачи ---
  app.append(el("div", { class: "panel" }, [
    el("h2", {}, "Порядок отправки на портале"),
    el("ol", {}, S.steps.map((s) => el("li", { style: "margin:4px 0" }, s))),
    el("div", { class: "muted", html:
      `Готовность по трекеру: <b>${S.readiness.percent}%</b> · проверки: ${badge(S.readiness.checksOverall)}. ` +
      "Пошлина 0 ₽. Срок цикла — ориентировочно 1–3 мес. (СВЕРИТЬ)." }),
  ]));
}

// ---------- о платформе ----------
function viewAbout() {
  app.innerHTML = "";
  app.append(el("div", { class: "panel" }, [
    el("h2", {}, "О платформе"),
    el("p", {}, "Локальный инструмент подготовки ПО к включению в Единый реестр российского ПО (Минцифры). Оборачивает пайплайн проверок и генерации досье в веб-интерфейс."),
    el("h3", {}, "Что можно сделать"),
    el("ul", { html:
      "<li>Завести карточку продукта и загрузить артефакты (SBOM/HAR).</li>" +
      "<li>Запустить технические проверки готовности (правило 30%, лицензии OSS, сетевой аудит, страница).</li>" +
      "<li>Вести трекер гейтов G0–G5; G3 заполняется из результатов проверок.</li>" +
      "<li>Сгенерировать пакет досье в .docx.</li>" }),
    el("div", { class: "hint", html:
      "Значения с пометкой «СВЕРИТЬ» (сроки, коды классов, форматы вложений) проверяйте на " +
      "<span class='mono'>reestr.digital.gov.ru</span> и в действующей редакции ПП № 1236 перед подачей." }),
  ]));
}

})();
