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
  { rx: /^#\/glossary$/, view: viewGlossary },
  { rx: /^#\/profile$/, view: viewProfile },
  { rx: /^#\/p\/([^/]+)\/checks$/, view: (m) => viewChecks(m[1]) },
  { rx: /^#\/p\/([^/]+)\/tracker(?:\/([A-Za-z0-9]+))?$/, view: (m) => viewTracker(m[1], m[2]) },
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

// Загрузчик артефакта: одна и та же кнопка+инпут — для SBOM/HAR (питают проверки G3,
// живут на «Проверках») и для файлов депонирования (dep_*, живут на «Документах»).
// onDone — что сделать после успешной загрузки (обычно — перерисовать текущий экран).
function uploader(id, kind, label, accept, onDone) {
  const acc = accept || (kind === "sbom" ? ".json" : ".har,.json");
  const inp = el("input", { type: "file", style: "display:none", accept: acc });
  inp.addEventListener("change", async () => {
    const file = inp.files[0]; if (!file) return;
    const buf = await file.arrayBuffer();
    await api.putRaw(`/api/products/${id}/artifacts/${kind}?name=${encodeURIComponent(file.name)}`, buf);
    if (kind !== "rights") await runChecksSilent(id);
    toast(`${label} загружен`);
    if (onDone) onDone();
  });
  return el("span", {}, [
    el("button", { class: "ghost", onclick: () => inp.click() }, `Загрузить ${label}`), inp,
  ]);
}

// ---------- маршрут подготовки: степпер по гейтам G0–G5 ----------
// Реальная единица стадийности процесса — гейт (см. 01_tracker/pipeline_tracker.md),
// не экран инструмента. Процесс НЕ линейный: G0/G1/G2/G4/G5 — организационные,
// готовятся параллельно друг другу и параллельно с G3 (авто-проверки). Поэтому клик
// по любому гейту всегда работает, без «Далее»/confirm — линейность тут была бы ложью.
const STEP_ICON = { done: "✅", blocked: "⛔", active: "🟡", todo: "🔲" };

// Тянет трекер (единственный источник статусов гейтов — tracker.buildTracker на сервере).
async function loadStepMeta(id) {
  const trackerRes = await api.get(`/api/products/${id}/tracker`).catch(() => null);
  return { tracker: trackerRes && trackerRes.tracker };
}

// Статус гейта: todo (🔲 не начат) · active (🟡 в работе) · done (✅ готово) ·
// blocked (⛔, только G3 — реальный FAIL в проверках). Ничего не считает заново —
// просто читает то, что уже посчитал tracker.buildTracker на сервере.
function gateStatus(gate, meta) {
  if (gate.auto) {
    const t = meta && meta.tracker;
    if (!t || !t.hasReport) return "todo";
    if (t.checksOverall === "FAIL") return "blocked";
    return gate.complete ? "done" : "active";
  }
  if (gate.complete) return "done";
  return gate.done > 0 ? "active" : "todo";
}

// Единая строка навигации: слева — компактные кружки гейтов G0–G5 (кликабельны
// независимо друг от друга, без «Далее»/confirm — процесс не линейный, подробности
// в title каждого кружка), справа — вкладки экранов инструмента. Раньше это были
// два визуально разных ряда друг под другом; по сути обе оси нужны, но не ценой
// двух отдельных блоков — сведены в один ряд.
function topNav(id, active, meta) {
  const gates = (meta && meta.tracker && meta.tracker.gates) || [];
  const gateNodes = [];
  gates.forEach((g, i) => {
    if (i > 0) {
      const prevStatus = gateStatus(gates[i - 1], meta);
      gateNodes.push(el("div", { class: "step-line" + (prevStatus === "todo" ? "" : " filled") }));
    }
    const status = gateStatus(g, meta);
    const href = g.auto ? `#/p/${id}/checks`
      : g.link ? `#/p/${id}${g.link}`
      : `#/p/${id}/tracker/${g.id}`;
    const statusText = { done: "готово", blocked: "есть блокеры", active: "в работе", todo: "не начато" }[status];
    gateNodes.push(el("a", { href, class: "step-circle " + status,
      title: `${g.id} ${g.title} — ${statusText} (${g.done}/${g.total})` }, g.id));
  });
  const gatesRow = gates.length
    ? el("div", { class: "stepper" }, gateNodes)
    : el("div", { class: "muted" }, "Гейты загружаются…");

  const items = [
    { k: "", t: "Карточка" }, { k: "/checks", t: "Проверки" },
    { k: "/tracker", t: "Трекер" }, { k: "/docs", t: "Документы" },
    { k: "/submit", t: "Отправка" },
  ];
  const tabsRow = el("div", { class: "tabs" }, items.map((it) => {
    const href = `#/p/${id}${it.k}`;
    const cls = "btn" + (active === it.k ? "" : " ghost");
    return el("a", { class: cls, href }, it.t);
  }));

  return el("div", { class: "topnav" }, [gatesRow, el("div", { class: "topnav-sep" }), tabsRow]);
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

// Мастер подготовки. Единственный путь — локальный источник кода (папка на этом ПК или
// ZIP): платформа делает снимок + SHA-256 + SBOM И заполняет карточку черновиком (из
// package.json/README + ваших заметок; при заданном ключе — с LLM-улучшением). Сеть не
// нужна — это убирает «падение» на тяжёлых репозиториях. Запасные пути (клон по ссылке,
// скачать и запустить скрипт самому) убраны: они дублировали этот же результат более
// длинным путём — раз сервер и так делает всю работу, показывать их «на всякий случай»
// не нужно (бритва Оккама).
// prepState — { git, npx, llm } из /api/prepare/status; onDraft(draft,result) применяет
// черновик к полям карточки (передаётся из viewProduct).
function prepWizard(id, prepState, onDraft) {
  const state = { mode: "path", path: "", notes: "", zipFile: null };
  const llmOn = !!(prepState && prepState.llm);
  const progress = el("div", { class: "muted", style: "font-size:12px;margin-top:6px" });

  // --- Основной путь: локальный источник ---
  const pathInp = el("input", { type: "text", value: "",
    placeholder: "C:\\путь\\к\\папке\\проекта   (или D:/code/my-app)" });
  pathInp.addEventListener("input", () => { state.path = pathInp.value.trim(); });

  const zipInp = el("input", { type: "file", accept: ".zip" });
  zipInp.addEventListener("change", () => { state.zipFile = (zipInp.files && zipInp.files[0]) || null; });

  const notesInp = el("textarea", { placeholder:
    "Коротко о продукте и о вас: что делает, для кого, кто правообладатель. Чем подробнее — тем точнее черновик.",
    style: "width:100%;min-height:64px" });
  notesInp.addEventListener("input", () => { state.notes = notesInp.value; });

  // Переключатель источника: папка / ZIP.
  const pathRow = el("label", { class: "field" }, [
    el("span", { style: "display:block;margin-bottom:4px" }, "Путь к папке проекта на этом ПК"), pathInp]);
  const zipRow = el("label", { class: "field", style: "display:none" }, [
    el("span", { style: "display:block;margin-bottom:4px" }, "ZIP-архив проекта"), zipInp]);
  const modeSel = el("select", {}, [
    el("option", { value: "path", selected: "selected" }, "Папка на этом ПК"),
    el("option", { value: "zip" }, "Загрузить ZIP"),
  ]);
  modeSel.addEventListener("change", () => {
    state.mode = modeSel.value;
    pathRow.style.display = state.mode === "path" ? "" : "none";
    zipRow.style.display = state.mode === "zip" ? "" : "none";
  });

  async function runLocal(btn) {
    if (state.mode === "path" && !state.path) { toast("Укажите путь к папке проекта", true); return; }
    if (state.mode === "zip" && !state.zipFile) { toast("Выберите ZIP-архив проекта", true); return; }
    const t0 = btn.textContent; btn.disabled = true; btn.textContent = "Заполняю…";
    progress.textContent = "Читаю проект, делаю снимок и SHA-256, заполняю карточку черновиком…";
    try {
      let resp;
      if (state.mode === "zip") {
        const buf = await state.zipFile.arrayBuffer();
        resp = await api.request("POST",
          `/api/products/${id}/autofill?notes=${encodeURIComponent(state.notes)}`, buf, true);
      } else {
        resp = await api.post(`/api/products/${id}/autofill`, { path: state.path, notes: state.notes });
      }
      const { result, draft } = resp;
      if (onDraft) onDraft(draft, result);
      const bits = [];
      if (result.archive) bits.push(`снимок готов (SHA-256 ${(result.sha256 || "").slice(0, 12)}…)`);
      if (result.sbom) bits.push("SBOM собран");
      toast("Карточка заполнена черновиком — проверьте и «Сохранить»" + (bits.length ? " · " + bits.join(", ") : ""));
      (result.warnings || []).forEach((w) => toast(w, true));
      progress.textContent = "Готово. Проверьте поля выше и нажмите «Сохранить». Снимок/листинг уже в артефактах.";
    } catch (e) {
      progress.textContent = "";
      toast(e.message || "Не удалось заполнить", true);
    } finally { btn.disabled = false; btn.textContent = t0; }
  }

  const fillBtn = el("button", { onclick: () => runLocal(fillBtn) }, "✨ Заполнить карточку из проекта");

  const statusHint = prepState
    ? el("div", { class: "hint", html:
        "Код берётся с этого ПК — сеть не нужна, тяжёлые репозитории не срываются. " +
        (prepState.npx ? "SBOM будет собран (npx доступен). " : "SBOM будет пропущен: нет npx (Node.js). ") +
        (llmOn ? "LLM-улучшение описания включено." : "LLM выключен — используется ваш текст как есть (офлайн).") })
    : el("div", { class: "hint muted" }, "Статус инструментов не получен.");

  return el("div", { class: "panel" }, [
    el("h2", {}, "🧙 Мастер подготовки — заполнить карточку и собрать файлы"),
    statusHint,
    el("label", { class: "field" }, [
      el("span", { style: "display:block;margin-bottom:4px" }, "Источник кода"), modeSel]),
    pathRow, zipRow,
    el("label", { class: "field" }, [
      el("span", { style: "display:block;margin-bottom:4px" }, "Коротко о продукте / о себе"), notesInp]),
    el("div", { class: "row", style: "align-items:center;gap:10px;margin:6px 0" }, [
      fillBtn,
      el("span", { class: "muted", style: "font-size:12px" },
        "Заполнит поля черновиком (проверьте и Сохранить) и создаст снимок + SBOM в артефактах."),
    ]),
    progress,
    el("div", { class: "hint", html:
      "Значения — <b>черновик</b>: проверьте и при необходимости поправьте перед сохранением. " +
      "Реквизиты правообладателя берутся из профиля; коды классов и юридические поля сверяет человек." }),
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
    el("td", { style: "width:1%;white-space:nowrap" }, c.pp325 ? "⚠️ ПП№325" : ""),
  ]));
  return help("📚 Классификатор ПО — официальные классы (СВЕРИТЬ подкласс)", [
    el("div", { class: "muted", style: "margin-bottom:6px", html:
      `Источник: <b>${esc(ref.source || "—")}</b>. Сверено: ${esc(ref.verifiedAt || "—")}. ` +
      "Ниже — верхнеуровневые классы. Точный <b>подкласс</b> (например 05.09) и его формулировку " +
      "сверьте на <span class='mono'>reestr.digital.gov.ru</span> перед подачей. " +
      "Пометка <b>ПП№325</b> — по этому классу в принципе действуют доптребования к ОС/СУБД/офисному ПО; " +
      "точный состав для вашего продукта также СВЕРИТЬ на портале." }),
    el("table", {}, [el("tr", {}, [el("th", {}, "Код"), el("th", {}, "Класс"), el("th", {}, "")]), ...rows]),
  ]);
}

// Виджет выбора класса(ов) ПО. Совместим с механизмом сохранения data-multi:
// выбранные коды хранятся как скрытые checked-чекбоксы внутри контейнера, поэтому
// save() соберёт их так же, как обычный мультивыбор. UI — чипы + select + подкласс.
// getContextText() — необязательный колбэк, отдающий текст (описание+назначение)
// для кнопки-подсказки класса по ключевым словам (core/class_hint.js).
function classMultiPicker(pathStr, list, curArr, getContextText) {
  const wrap = el("div", { class: "multi classmulti", "data-path": pathStr, "data-multi": "1" });
  const chips = el("div", { class: "chips" });
  const pp325Note = el("div", { class: "muted", style: "font-size:12px;margin-top:4px;display:none" },
    "⚠️ Для выбранного класса в принципе действуют доптребования ПП №325 (к ОС/СУБД/офисному ПО) — сверьте точный состав на reestr.digital.gov.ru перед подачей.");
  const selected = curArr.slice();

  function hiddenBox(code) {
    // Скрытый чекбокс — носитель значения для save() (читает input[type=checkbox]:checked).
    return el("input", { type: "checkbox", value: code, checked: "checked", style: "display:none" });
  }
  function renderChips() {
    chips.innerHTML = "";
    wrap.querySelectorAll("input[type=checkbox]").forEach((c) => c.remove());
    selected.forEach((code) => {
      const known = list.find((c) => c.code === code || code.startsWith(c.code + "."));
      const label = known ? `${code} — ${known.name}` : code;
      chips.append(el("span", { class: "chip" }, [
        el("span", {}, label),
        el("a", { href: "#", class: "chip-x", onclick: (e) => {
          e.preventDefault();
          const i = selected.indexOf(code); if (i >= 0) selected.splice(i, 1); renderChips();
        } }, "×"),
      ]));
      wrap.append(hiddenBox(code));
    });
    if (!selected.length) chips.append(el("span", { class: "muted" }, "классы не выбраны"));
    // ПП№325 — применимо, если хотя бы один выбранный код относится к классу с pp325=true
    // (сверяем по верхнеуровневому коду, т.к. справочник хранит только его).
    const applies = selected.some((code) => {
      const top = list.find((c) => code.startsWith(c.code));
      return top && top.pp325;
    });
    pp325Note.style.display = applies ? "" : "none";
  }
  function add(code) {
    const v = (code || "").trim();
    if (!v || selected.includes(v)) return;
    selected.push(v); renderChips();
  }

  const sel = el("select", {}, [
    el("option", { value: "" }, "— выберите класс —"),
    ...list.map((c) => el("option", { value: c.code }, `${c.code} — ${c.name}`)),
  ]);
  const addBtn = el("button", { class: "ghost", type: "button",
    onclick: () => { add(sel.value); sel.value = ""; } }, "Добавить");
  const subInp = el("input", { type: "text", placeholder: "подкласс, напр. 05.09 — СВЕРИТЬ", style: "max-width:220px" });
  const addSubBtn = el("button", { class: "ghost", type: "button",
    onclick: () => { add(subInp.value); subInp.value = ""; } }, "Добавить подкласс");

  wrap.append(
    chips,
    pp325Note,
    el("div", { class: "row", style: "gap:6px;flex-wrap:wrap;margin-top:6px" }, [sel, addBtn]),
    el("div", { class: "row", style: "gap:6px;flex-wrap:wrap;margin-top:4px" }, [subInp, addSubBtn]),
  );

  // Подсказка класса по описанию/назначению — по ключевым словам, детерминированно,
  // без сети (class_hint.js). Кандидаты кликабельны — добавляют код тем же add().
  if (typeof getContextText === "function") {
    const suggestMsg = el("span", { class: "muted", style: "font-size:12px" });
    const suggestBtn = el("button", { class: "ghost", type: "button", onclick: suggest }, "💡 Подсказать класс по описанию");
    wrap.append(el("div", { class: "row", style: "gap:8px;flex-wrap:wrap;margin-top:6px;align-items:center" }, [suggestBtn, suggestMsg]));

    async function suggest() {
      suggestMsg.textContent = "…";
      try {
        const { suggestions } = await api.post("/api/reference/suggest-class", { text: getContextText() });
        suggestMsg.innerHTML = "";
        if (!suggestions.length) { suggestMsg.textContent = "Совпадений по ключевым словам не найдено — выберите класс вручную."; return; }
        suggestMsg.append("Кандидаты: ");
        suggestions.forEach((s) => {
          suggestMsg.append(el("a", { href: "#", style: "margin-right:10px", onclick: (e) => { e.preventDefault(); add(s.code); } },
            `${s.code} — ${s.name}${s.pp325 ? " ⚠️ПП№325" : ""}`));
        });
      } catch (e) { suggestMsg.textContent = "Ошибка: " + (e.message || e); }
    }
  }

  renderChips();
  return wrap;
}

// Грубая оценка «на каком шаге маршрута сейчас продукт» без доп. запросов — только
// по сводке, которую уже отдаёт /api/products (percent из трекера, статус проверок).
// Точный расчёт (с учётом полноты карточки) — на самой странице продукта (stepStatus).
// Один текст вместо трёх параллельных индикаторов (было: прогресс-бар + «Готовность:
// X% · Проверки: badge» + бейдж стадии). Процент уже виден на самом прогресс-баре —
// в тексте оставляем то, чего бар не показывает: смысл текущего состояния и, если
// уместно, число.
function dashboardStage(p) {
  if (p.checksOverall === "FAIL") return { key: "blocked", text: "⛔ Есть блокеры в проверках" };
  if (!p.hasReport) return { key: "todo", text: "🔲 Карточка и проверки" };
  if (p.percent < 100) return { key: "active", text: `🟡 Трекер гейтов · ${p.percent}%` };
  return { key: "done", text: "✅ Готово к отправке" };
}

// ---------- дашборд ----------
async function viewDashboard() {
  const { products } = await api.get("/api/products");
  const head = el("div", { class: "row", style: "align-items:center;margin-bottom:16px" }, [
    el("h2", { style: "margin:0;color:var(--blue);flex:1" }, `Продукты (${products.length})`),
    el("button", { onclick: createProduct }, "+ Новый продукт"),
  ]);

  const grid = el("div", { class: "grid" }, products.map((p) => {
    const stage = dashboardStage(p);
    const card = el("div", { class: "card", onclick: () => (location.hash = `#/p/${p.id}`) }, [
      el("div", { class: "name" }, p.name),
      el("div", { class: "meta" }, `${p.shortName || "—"} · ${p.deliveryType || "—"}`),
      progressBar(p.percent),
      el("div", { class: "step-tag " + stage.key }, stage.text),
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
  const stepMeta = await loadStepMeta(id);
  // Доступно ли автозаполнение по ИНН (DaData). Без ключа на сервере — кнопки нет.
  const egrulStatus = await api.get("/api/egrul/status").catch(() => ({ enabled: false }));
  // Доступны ли git/npx на этом ПК — определяет режим «Мастера подготовки».
  const prepState = await api.get("/api/prepare/status").catch(() => null);
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
    ["product.class", "Класс(ы) ПО", "classmulti", "выберите класс(ы) из официального списка · подкласс СВЕРИТЬ"],
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
    ["support.contactFio", "Контакт ТП — ФИО", "text", "из профиля"],
    ["support.contactEmail", "Контакт ТП — email", "text", "из профиля"],
    ["support.contactPhone", "Контакт ТП — телефон", "text", "из профиля"],
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
    } else if (type === "classmulti") {
      // Официальный классификатор: выбор класса из <select> + кнопка «Добавить».
      // Выбранное показывается «чипами» с удалением; можно добавить подкласс (NN.NN)
      // вручную. Значение — массив кодов, читается через data-multi при сохранении.
      labelStyle = "grid-column:1 / -1";
      const list = (classesRef && classesRef.classes) || [];
      const curArr = Array.isArray(cur) ? cur.slice() : (cur ? [cur] : []);
      const getContextText = () => {
        const d = document.querySelector('[data-path="product.description"]');
        const pu = document.querySelector('[data-path="product.purpose"]');
        return [(d && d.value) || "", (pu && pu.value) || ""].join(" ");
      };
      input = classMultiPicker(pathStr, list, curArr, getContextText);
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
    // Кнопка автозаполнения по ИНН (только если DaData настроена на сервере).
    if (pathStr === "rightholder.inn" && egrulStatus && egrulStatus.enabled) {
      extra = el("button", { class: "ghost", type: "button", style: "margin-top:4px",
        onclick: (ev) => egrulFill(ev.target) }, "Заполнить по ИНН");
    }
    const spanKids = [el("span", {}, label)];
    if (hint) spanKids.push(el("span", { class: "tag" }, hint));
    return el("label", { class: "field", style: labelStyle },
      [el("span", { style: "display:block;margin-bottom:4px" }, spanKids), input, extra]);
  }));

  // Автозаполнение реквизитов по ИНН: тянет из DaData и подставляет в поля формы.
  // Данные — черновик; человек проверяет и жмёт «Сохранить». Адрес пишем прямо в
  // объект product (в форме отдельного поля адреса нет), он сохранится вместе с карточкой.
  async function egrulFill(btn) {
    const innInp = app.querySelector('[data-path="rightholder.inn"]');
    const inn = (innInp && innInp.value || "").trim();
    if (!inn) { toast("Сначала введите ИНН", true); return; }
    const t0 = btn.textContent; btn.disabled = true; btn.textContent = "…";
    try {
      const { data } = await api.post("/api/egrul/lookup", { inn });
      const setField = (path, v) => { const n = app.querySelector(`[data-path="${path}"]`); if (n && v) n.value = v; };
      setField("rightholder.orgName", data.orgName);
      setField("rightholder.ogrn", data.ogrn);
      if (data.address) { product.rightholder = product.rightholder || {}; product.rightholder.address = data.address; }
      const st = data.status && data.status !== "ACTIVE" ? ` · статус: ${data.status}` : "";
      toast(`Реквизиты подставлены — проверьте и сохраните${st}`);
    } catch (e) {
      toast(e.message || "Не удалось получить данные", true);
    } finally { btn.disabled = false; btn.textContent = t0; }
  }

  // Применяет ЧЕРНОВИК из «Мастера подготовки» к полям формы (не сохраняет — человек
  // проверяет и жмёт «Сохранить»). Патч — вложенный объект (product.*, tech.*); поля
  // без инпута (напр. product.version) пишутся прямо в product и уедут при сохранении.
  function applyDraft(draft) {
    const patch = (draft && draft.patch) || {};
    const flat = {};
    (function walk(obj, pre) {
      for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith("_")) continue; // служебные подсказки (_classHint)
        const path = pre ? pre + "." + k : k;
        if (v && typeof v === "object" && !Array.isArray(v)) walk(v, path);
        else flat[path] = v;
      }
    })(patch, "");
    let n = 0;
    for (const [path, val] of Object.entries(flat)) {
      const inp = app.querySelector(`[data-path="${path}"]`);
      if (!inp) { setVal(path, val); n++; continue; }
      applyToInput(inp, val); n++;
    }
    if (patch._classHint) toast("Возможный класс ПО: " + patch._classHint);
    return n;
  }
  // Подставляет значение в конкретный инпут с учётом его типа (multi/list/обычный).
  function applyToInput(inp, val) {
    if (inp.getAttribute("data-multi")) {
      const vals = Array.isArray(val) ? val : [val];
      const boxes = Array.from(inp.querySelectorAll("input[type=checkbox]"));
      const extra = inp.querySelector(".multi-extra");
      const leftover = [];
      vals.forEach((v) => {
        const b = boxes.find((x) => x.value === v || x.value.toLowerCase().includes(String(v).toLowerCase()));
        if (b) b.checked = true; else leftover.push(v);
      });
      if (extra && leftover.length) {
        const cur = extra.value ? extra.value.split(",").map((s) => s.trim()).filter(Boolean) : [];
        extra.value = Array.from(new Set([...cur, ...leftover])).join(", ");
      }
    } else if (inp.getAttribute("data-list")) {
      inp.value = Array.isArray(val) ? val.join(", ") : String(val == null ? "" : val);
    } else {
      inp.value = Array.isArray(val) ? val.join(", ") : (val == null ? "" : val);
    }
  }

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
  app.innerHTML = "";
  app.append(
    crumbs([{ text: "Продукты", href: "#/" }, { text: p.name || id }]),
    topNav(id, "", stepMeta),
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
    prepWizard(id, prepState, applyDraft),
    el("div", { class: "hint", html:
      "Дальше по маршруту: загрузка <b>SBOM/HAR</b> и запуск проверок — на вкладке " +
      `<a href="#/p/${id}/checks">«Проверки»</a>; файлы для депонирования и реферат — на ` +
      `<a href="#/p/${id}/docs">«Документах»</a>.` }),
  );
}

// ---------- проверки ----------
async function viewChecks(id) {
  const { product } = await api.get(`/api/products/${id}`);
  const name = (product.product && product.product.name) || id;
  const { report } = await api.get(`/api/products/${id}/report`);
  const { artifacts } = await api.get(`/api/products/${id}/artifacts`);
  const stepMeta = await loadStepMeta(id);

  app.innerHTML = "";
  app.append(crumbs([{ text: "Продукты", href: "#/" }, { text: name, href: `#/p/${id}` }, { text: "Проверки" }]),
    topNav(id, "/checks", stepMeta));

  // Артефакты, которые питают проверки (SBOM/HAR); документы депонирования (dep_/rights_) — на «Документах».
  const checkArtifacts = artifacts.filter((a) => !/^(dep_|rights_)/i.test(a.name));
  const artList = el("div", {}, checkArtifacts.length
    ? checkArtifacts.map((a) => el("div", { class: "meta mono" }, `• ${a.name} (${a.size} б)`))
    : [el("div", { class: "muted" }, "нет загруженных артефактов")]);
  const harAutoBtn = el("button", { class: "ghost", onclick: collectHarAuto }, "🌐 Собрать HAR автоматически");
  const harAutoMsg = el("div", { class: "muted", style: "font-size:12px;margin-top:6px" });

  app.append(el("div", { class: "panel" }, [
    el("h2", {}, "Артефакты для проверок"),
    el("div", { class: "hint", html: "Загрузите два файла из вашего продукта — по ним пройдут проверки лицензий и сетевого аудита (гейт G3). <b>SBOM</b> собирает «Мастер подготовки» на карточке; <b>HAR</b> снимается в браузере (см. ниже) либо автоматически." }),
    el("div", { class: "row", style: "gap:8px" }, [
      uploader(id, "sbom", "SBOM", null, () => viewChecks(id)),
      uploader(id, "har", "HAR", null, () => viewChecks(id)),
      harAutoBtn,
    ]),
    harAutoMsg,
    el("div", { class: "spacer" }), artList,
    el("div", { class: "spacer" }),
    harHelp(),
  ]));

  const liveChk = el("input", { type: "checkbox", id: "live-check" });
  const runBtn = el("button", { onclick: run }, "▶ Запустить проверки");
  const panel = el("div", { class: "panel" }, [
    el("div", { class: "row", style: "align-items:center" }, [
      el("h2", { style: "flex:1;margin:0" }, "Технические проверки готовности"), runBtn,
    ]),
    el("div", { class: "muted", style: "margin:4px 0 8px;font-size:12px" },
      "Обновляются автоматически при сохранении карточки и загрузке артефактов. Кнопка — для ручного перезапуска."),
    el("label", { class: "chk", style: "font-size:12px;margin-bottom:8px" }, [liveChk,
      el("span", {}, " добавить живую проверку страницы (реальный HTTP-запрос к URL продукта из этого окружения)")]),
    el("div", { id: "checks-body" }),
  ]);
  app.append(panel);
  renderReport(report);

  // Автосбор HAR: headless-браузер сам открывает productPageUrl и записывает сетевой
  // трафик — избавляет от ручного F12→Network→Save as HAR. Опционально: требует
  // Node.js (npx) и один раз скачивает браузер Playwright (~150 МБ) при первом запуске.
  async function collectHarAuto() {
    harAutoBtn.disabled = true;
    const prevText = harAutoBtn.textContent;
    harAutoBtn.textContent = "Собираю…";
    harAutoMsg.textContent = "Открываю страницу продукта headless-браузером — при первом запуске может понадобиться скачать браузер (до нескольких минут)…";
    try {
      const res = await api.post(`/api/products/${id}/collect-har`);
      if (res.warnings && res.warnings.length) {
        harAutoMsg.textContent = res.warnings.join(" ");
        toast("Готово с замечаниями — см. ниже", true);
      } else {
        harAutoMsg.textContent = `Сохранено: ${res.artifact} (хостов записано: ${res.hostsCount ?? "—"}).`;
        toast("HAR собран автоматически");
      }
      await viewChecks(id);
    } catch (e) {
      harAutoMsg.textContent = "Не удалось собрать HAR автоматически: " + (e.message || e) + ". Используйте ручной способ ниже.";
      toast("Ошибка автосбора HAR", true);
    } finally {
      harAutoBtn.disabled = false; harAutoBtn.textContent = prevText;
    }
  }

  async function run() {
    runBtn.disabled = true; runBtn.textContent = "Выполняется…";
    try {
      const qs = liveChk.checked ? "?live=1" : "";
      const res = await api.post(`/api/products/${id}/checks${qs}`);
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
// focusGateId (опционально) — с каким гейтом открыть страницу: пришли с клика по
// гейт-степперу на другом экране (#/p/:id/tracker/:gateId). Просто подсвечиваем и
// скроллим к нему — сами гейты и их состав не меняются.
async function viewTracker(id, focusGateId) {
  const { product } = await api.get(`/api/products/${id}`);
  const name = (product.product && product.product.name) || id;
  const { tracker } = await api.get(`/api/products/${id}/tracker`);
  const stepMeta = { tracker };

  app.innerHTML = "";
  app.append(crumbs([{ text: "Продукты", href: "#/" }, { text: name, href: `#/p/${id}` }, { text: "Трекер" }]),
    topNav(id, "/tracker", stepMeta));

  const overall = el("div", { class: "panel" }, [
    el("div", { class: "row", style: "align-items:center", html:
      `<h2 style="flex:1;margin:0">Готовность: ${tracker.percent}%</h2>` +
      `<span class="muted">${tracker.done}/${tracker.total} пунктов · проверки: ${badge(tracker.checksOverall)}</span>` }),
    progressBar(tracker.percent),
  ]);
  app.append(overall);

  let focusNode = null;
  tracker.gates.forEach((g) => {
    const readOnly = g.auto || g.artifacts;   // выводится из проверок/артефактов
    const autoTag = g.auto ? "из проверок" : g.artifacts ? "из документов" : null;
    const items = g.items.map((it) => {
      const cb = el("input", { type: "checkbox", ...(it.done ? { checked: "checked" } : {}),
        ...(readOnly ? { disabled: "disabled" } : {}) });
      if (!readOnly) cb.addEventListener("change", async () => {
        await api.put(`/api/products/${id}/tracker`, { items: { [it.id]: cb.checked } });
        toast("Отмечено"); viewTracker(id);
      });
      return el("label", { class: "item" + (readOnly ? " auto" : "") }, [
        cb, el("span", {}, it.text),
        autoTag ? el("span", { class: "auto-tag" }, autoTag) : null,
      ]);
    });
    const isFocus = focusGateId && g.id === focusGateId;
    const gateNode = el("div", { class: "gate" + (isFocus ? " focus" : "") }, [
      el("div", { class: "head", html:
        `<span class="gid">${esc(g.id)}</span> <span>${esc(g.title)}</span>` +
        `<span class="pct">${g.done}/${g.total}${g.auto ? " · авто" : g.artifacts ? " · из документов" : ""}</span>` }),
      g.artifacts ? el("div", { class: "muted", style: "font-size:12px;margin:2px 0 6px" },
        "Пункты закрываются автоматически при загрузке/генерации файлов на вкладке «Документы».") : null,
      el("div", { class: "items" }, items),
    ]);
    if (isFocus) focusNode = gateNode;
    app.append(gateNode);
  });

  if (!tracker.hasReport) app.append(el("div", { class: "hint" },
    "Гейт G3 заполнится после запуска проверок на вкладке «Проверки»."));
  if (focusNode) focusNode.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- документы ----------
async function viewDocs(id) {
  const { product } = await api.get(`/api/products/${id}`);
  const name = (product.product && product.product.name) || id;
  const { docs } = await api.get(`/api/products/${id}/dossier`);
  const { artifacts } = await api.get(`/api/products/${id}/artifacts`);
  const stepMeta = await loadStepMeta(id);
  const p = product.product || {};
  const rh = product.rightholder || {};
  const t = product.tech || {};

  app.innerHTML = "";
  app.append(crumbs([{ text: "Продукты", href: "#/" }, { text: name, href: `#/p/${id}` }, { text: "Документы" }]),
    topNav(id, "/docs", stepMeta));

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

  // --- Трекер подготовки к депонированию (Роспатент) ---
  // Пункты: ключ (= префикс файлов), формулировка, допустимые форматы.
  // [ключ, подпись, форматы загрузки, genKind|null] — genKind: можно сгенерировать автоматически.
  const DEPON_ITEMS = [
    ["dep_snapshot",  "Снимок версии кода + акт фиксации (SHA-256)",      ".zip,.tar,.gz,.7z,.rar", "dep_snapshot"],
    ["dep_referat",   "Реферат программы",                                ".docx,.pdf,.txt", "dep_referat"],
    ["dep_codefrag",  "Фрагмент исходного кода (до 70 страниц)",          ".pdf,.docx", "dep_codefrag"],
    ["dep_chain",     "Цепочка прав: договоры, служебные задания, акты",  ".pdf,.zip,.docx", "dep_chain"],
    ["dep_statement", "Заявление в Роспатент, подписанное УКЭП",          ".pdf,.sig,.zip", "dep_statement"],
    ["dep_cert",      "Свидетельство о госрегистрации ПО",                ".pdf,.png,.jpg,.jpeg", null],
  ];

  async function genDepon(kind, btn) {
    btn.disabled = true; const t0 = btn.textContent; btn.textContent = "…";
    try {
      const res = await api.post(`/api/products/${id}/depon/${kind}`);
      toast(`Сгенерировано: ${res.generated.title}`);
      viewDocs(id);
    } catch (e) { toast(e.message || "Ошибка генерации", true); btn.disabled = false; btn.textContent = t0; }
  }

  // Внутреннее сырьё авто-подготовки (листинг для фрагмента) не показываем и не считаем документом.
  const isDeponRaw = (name) => /^dep_codefrag_listing\.txt$/i.test(name);
  const deponRows = DEPON_ITEMS.map(([key, label, accept, genKind]) => {
    const files = artifacts.filter((a) => a.name.toLowerCase().startsWith(key + "_") && !isDeponRaw(a.name));
    const done = files.length > 0;
    const filesCell = files.length
      ? el("div", {}, files.map((a) => el("div", { class: "mono", style: "margin:1px 0" }, [
          el("a", { href: `/api/products/${id}/artifacts/file/${encodeURIComponent(a.name)}` },
            a.name.slice(key.length + 1)),
          el("a", { href: "#", style: "margin-left:8px;color:var(--fail)", onclick: async (e) => {
            e.preventDefault();
            if (confirm("Удалить файл?")) { await api.del(`/api/products/${id}/artifacts/${encodeURIComponent(a.name)}`); viewDocs(id); }
          } }, "×"),
        ])))
      : el("span", { class: "muted" }, "—");
    const actions = [uploader(id, key, "файл", accept, () => viewDocs(id))];
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
  const deponDone = DEPON_ITEMS.filter(([key]) => artifacts.some((a) => a.name.toLowerCase().startsWith(key + "_") && !isDeponRaw(a.name))).length;

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

  app.append(el("div", { class: "panel" }, [
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
      `«Снимок версии кода» готовит «Мастер подготовки» на карточке; загрузить готовый файл сюда можно и вручную.`),
    codefragHelp(),
    referatDraft,
  ]));
}

// ---------- отправка (монтажный лист подачи) ----------
async function viewSubmit(id) {
  const { submission } = await api.get(`/api/products/${id}/submission`);
  const S = submission;
  const stepMeta = await loadStepMeta(id);

  app.innerHTML = "";
  app.append(
    crumbs([{ text: "Продукты", href: "#/" }, { text: S.productName, href: `#/p/${id}` }, { text: "Отправка" }]),
    topNav(id, "/submit", stepMeta),
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

// ---------- профиль правообладателя ----------
// Единый профиль: заполняется один раз, реквизиты и контакты ТП подставляются
// в новые карточки продуктов. Поля соответствуют FIELDS в api/profile.js.
async function viewProfile() {
  const { profile } = await api.get("/api/profile");
  const egrulStatus = await api.get("/api/egrul/status").catch(() => ({ enabled: false }));

  const fields = [
    ["rightholder.orgName", "Правообладатель (наименование)", "text"],
    ["rightholder.inn", "ИНН", "text"],
    ["rightholder.ogrn", "ОГРН", "text"],
    ["rightholder.address", "Адрес правообладателя", "text"],
    ["rightholder.ruControlSharePercent", "Доля РФ-контроля, %", "number"],
    ["rightholder.signatory.name", "Подписант — ФИО", "text"],
    ["rightholder.signatory.position", "Подписант — должность", "text"],
    ["support.contactFio", "Контакт ТП — ФИО", "text"],
    ["support.contactEmail", "Контакт ТП — email", "text"],
    ["support.contactPhone", "Контакт ТП — телефон", "text"],
  ];

  const getVal = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), profile);

  const form = el("div", { class: "two-col" }, fields.map(([path, label, type]) => {
    const cur = getVal(path);
    const input = el("input", { type: type === "number" ? "number" : "text", "data-path": path,
      value: cur == null ? "" : cur });
    let extra = null;
    if (path === "rightholder.inn" && egrulStatus && egrulStatus.enabled) {
      extra = el("button", { class: "ghost", type: "button", style: "margin-top:4px",
        onclick: (ev) => fillInn(ev.target) }, "Заполнить по ИНН");
    }
    return el("label", { class: "field" },
      [el("span", { style: "display:block;margin-bottom:4px" }, label), input, extra]);
  }));

  async function fillInn(btn) {
    const innInp = app.querySelector('[data-path="rightholder.inn"]');
    const inn = (innInp && innInp.value || "").trim();
    if (!inn) { toast("Сначала введите ИНН", true); return; }
    const t0 = btn.textContent; btn.disabled = true; btn.textContent = "…";
    try {
      const { data } = await api.post("/api/egrul/lookup", { inn });
      const set = (p, v) => { const n = app.querySelector(`[data-path="${p}"]`); if (n && v) n.value = v; };
      set("rightholder.orgName", data.orgName);
      set("rightholder.ogrn", data.ogrn);
      set("rightholder.address", data.address);
      toast("Реквизиты подставлены — проверьте и сохраните");
    } catch (e) { toast(e.message || "Не удалось получить данные", true); }
    finally { btn.disabled = false; btn.textContent = t0; }
  }

  async function save() {
    const out = {};
    app.querySelectorAll("[data-path]").forEach((inp) => {
      const keys = inp.getAttribute("data-path").split(".");
      let o = out;
      for (let i = 0; i < keys.length - 1; i++) { o[keys[i]] = o[keys[i]] || {}; o = o[keys[i]]; }
      o[keys[keys.length - 1]] = inp.type === "number" ? (inp.value === "" ? null : Number(inp.value)) : inp.value;
    });
    await api.put("/api/profile", { profile: out });
    toast("Профиль сохранён");
  }

  app.innerHTML = "";
  app.append(el("div", { class: "panel" }, [
    el("h2", {}, "Профиль правообладателя"),
    el("div", { class: "hint", html:
      "Заполните один раз — реквизиты организации и контакты техподдержки будут " +
      "<b>автоматически подставляться</b> в каждый новый продукт. В карточке продукта значения можно переопределить." }),
    form,
    el("div", { class: "row", style: "margin-top:8px" }, [el("button", { onclick: save }, "Сохранить профиль")]),
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
    conditionsHelp(),
  ]));
}

// ---------- Словарь (глоссарий) ----------
// Мини-рендерер markdown под подмножество ГЛОССАРИЙ.md: заголовки, списки,
// **жирный**, `код`, ---, ссылки. Сначала экранируем, потом инлайны — безопасно.
function mdInline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function mdToHtml(md) {
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const raw of String(md).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (/^#{1,6}\s/.test(line)) {
      closeList();
      const lvl = line.match(/^(#{1,6})/)[1].length;
      out.push(`<h${lvl}>${mdInline(line.replace(/^#{1,6}\s+/, ""))}</h${lvl}>`);
    } else if (/^---+$/.test(line)) {
      closeList(); out.push("<hr>");
    } else if (/^-\s+/.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${mdInline(line.replace(/^-\s+/, ""))}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList(); out.push(`<p>${mdInline(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}
async function viewGlossary() {
  app.innerHTML = "";
  const panel = el("div", { class: "panel glossary" }, [el("p", {}, "Загрузка словаря…")]);
  app.append(panel);
  try {
    const md = await api.get("/api/reference/glossary");
    panel.innerHTML = mdToHtml(md);
  } catch (e) {
    panel.innerHTML = "";
    panel.append(
      el("h2", {}, "Словарь недоступен"),
      el("p", {}, "Не удалось загрузить глоссарий: " + (e && e.message || "ошибка")),
    );
  }
}

})();
