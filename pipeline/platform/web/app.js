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
  { rx: /^#\/normative$/, view: viewNormative },
  { rx: /^#\/sources$/, view: viewSources },
  { rx: /^#\/profile$/, view: viewProfile },
  { rx: /^#\/p\/([^/]+)\/checks$/, view: (m) => viewChecks(m[1]) },
  { rx: /^#\/p\/([^/]+)\/product$/, view: (m) => viewProduct(m[1], "product") },
  { rx: /^#\/p\/([^/]+)\/docs$/, view: (m) => viewDocs(m[1]) },
  { rx: /^#\/p\/([^/]+)\/card$/, view: (m) => viewProduct(m[1], "card") },
  { rx: /^#\/p\/([^/]+)\/submit$/, view: (m) => viewSubmit(m[1]) },
  // Домашний экран продукта = Депонирование (Роспатент), первая стадия маршрута.
  // Карточка ООО (правообладатель/финансы) — отдельный экран /card, не старт.
  { rx: /^#\/p\/([^/]+)$/, view: (m) => viewDocs(m[1]) },
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

// ---------- маршрут-стадии + сайдбар-чеклист (проекция данных) ----------
// Единица маршрута — СТАДИЯ (Карточка → Продукт → Депонирование → Артефакты/
// проверки → Подача). Чек-лист не отмечается вручную: сервер (core/tracker.js)
// вычисляет статус каждого пункта из карточки/отчёта/артефактов. Здесь только
// рисуем то, что он посчитал: степпер сверху + постоянный чек-лист справа.

// Тянет проекцию маршрута (единственный источник статусов стадий — tracker.buildTracker).
async function loadTracker(id) {
  const res = await api.get(`/api/products/${id}/tracker`).catch(() => null);
  return res && res.tracker;
}

// Статус стадии: done (✅) · blocked (⛔, только «проверки» при FAIL) ·
// active (🟡 начата) · todo (🔲). Только читает то, что посчитал сервер.
function stageStatus(stage, tracker) {
  if (stage.id === "checks" && tracker && tracker.checksOverall === "FAIL" && !stage.complete) return "blocked";
  if (stage.complete) return "done";
  return stage.done > 0 ? "active" : "todo";
}
const STATUS_WORD = { done: "закрыта", blocked: "есть блокеры", active: "в работе", todo: "не начата" };

// Горизонтальный степпер стадий: кружки с номером, соединённые линиями, кликабельны.
function stageStepper(id, tracker, activeStageId) {
  const stages = ((tracker && tracker.stages) || []).filter((s) => !s.hidden);
  // Одна видимая стадия — степпер не несёт информации, не показываем.
  if (stages.length < 2) return el("span", {});
  const nodes = [];
  stages.forEach((s, i) => {
    if (i > 0) {
      const prev = stageStatus(stages[i - 1], tracker);
      nodes.push(el("div", { class: "step-line" + (prev === "todo" ? "" : " filled") }));
    }
    const status = stageStatus(s, tracker);
    const cls = "step-circle " + status + (s.id === activeStageId ? " current" : "");
    nodes.push(el("a", { href: `#/p/${id}${s.link || ""}`, class: cls,
      title: `${s.title} — ${STATUS_WORD[status]} (${s.done}/${s.total})` }, String(i + 1)));
  });
  return stages.length
    ? el("div", { class: "stepper" }, nodes)
    : el("div", { class: "muted" }, "Стадии загружаются…");
}

// Единый каркас экрана продукта: крошки + степпер стадий + одна широкая колонка
// с основным контентом. Прогресс/чек-лист вынесены из рабочего экрана —
// статус стадий виден в степпере сверху.
function renderShell(id, activeStageId, tracker, name, crumbLabel, mainNodes) {
  app.innerHTML = "";
  app.append(
    crumbs([{ text: "Продукты", href: "#/" },
      { text: name, href: `#/p/${id}` },
      ...(crumbLabel ? [{ text: crumbLabel }] : [])]),
    stageStepper(id, tracker, activeStageId),
    el("div", { class: "product-layout" }, [
      el("div", { class: "product-main" }, mainNodes),
    ]),
  );
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
    progress.textContent = "Читаю проект, делаю снимок версии, заполняю карточку черновиком…";
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
      if (result.archive) bits.push("снимок версии готов");
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
      "Остальное закрывается само по мере заполнения карточки — см. чек-лист справа." }),
  ]);
}
function codefragHelp() {
  return help("📄 Как получить фрагмент исходного кода (до 50 страниц)", [
    el("div", { html:
      "<b>Что это.</b> Для Роспатента депонируется не весь код, а <b>реферат + фрагмент листинга</b>. " +
      "Объём фрагмента — <b>не более 50 страниц</b> (рекомендация ФИПС)." }),
    el("ol", { html:
      "<li>Если код небольшой (≤50 стр.) — включите его целиком.</li>" +
      "<li>Если кода много — берут <b>первые 25 и последние 25 страниц</b> листинга " +
      "(итого ≤50). Включайте значимые модули: точку входа и ключевую логику.</li>" +
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
  if (p.percent < 100) return { key: "active", text: `🟡 В работе · ${p.percent}%` };
  return { key: "done", text: "✅ Готово к отправке" };
}

// ---------- дашборд (MCP-first) ----------
// Главный вход — Claude по MCP. Веб показывает: кто подключён, лента действий,
// продукты (витрина + скачивание). Никого нет и продуктов нет → экран подключения.
function fmtAgo(iso) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "только что";
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  if (s < 86400) return `${Math.round(s / 3600)} ч назад`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

function onboardingPanel(clientUrl) {
  return el("div", { class: "panel", style: "max-width:640px;margin:40px auto" }, [
    el("h2", { style: "margin:0 0 6px" }, "Нет подключённых устройств"),
    el("div", { class: "hint" },
      "Платформа управляется через Claude (MCP). Подключи клиента — и говори с платформой словами: " +
      "«создай продукт», «подготовь к Роспатенту», «прогони проверки»."),
    el("ol", { style: "line-height:1.9;margin:12px 0" }, [
      el("li", {}, [el("a", { href: "/api/client.zip" }, "⬇ Скачать клиент (reestr-mcp.zip)")]),
      el("li", {}, "Распаковать, вписать своё имя в .mcp.json — инструкция внутри (README)"),
      el("li", {}, "Сказать Claude: «список продуктов через reestr-platform»"),
    ]),
    el("div", { class: "muted", style: "font-size:12px" },
      `Сервер: ${clientUrl || "этот адрес"} · экран обновится сам после подключения`),
  ]);
}

async function viewDashboard() {
  const { products } = await api.get("/api/products");
  const act = await api.get("/api/activity").catch(() => ({ connections: [], feed: [] }));
  const conns = act.connections || [];
  const feed = act.feed || [];

  // Пусто и никто не подключался → онбординг вместо пустого дашборда.
  if (!products.length && !conns.length) {
    const { url } = await api.get("/api/client").catch(() => ({ url: "" }));
    app.innerHTML = "";
    app.append(onboardingPanel(url));
    // Автообновление: человек подключает Claude — экран сам перейдёт в дашборд.
    setTimeout(() => { if ((location.hash || "#/") .match(/^#?\/?$/)) router(); }, 15000);
    return;
  }

  // --- Подключения ---
  const connRows = conns.map((c) => el("span", { class: "tag",
    style: c.active ? "color:var(--ok,#2e7d32);border-color:currentColor" : "" },
    `${c.active ? "●" : "○"} ${c.actor} — ${fmtAgo(c.lastSeen)}`));
  const connPanel = el("div", { class: "panel" }, [
    el("div", { class: "row", style: "align-items:center" }, [
      el("h2", { style: "flex:1;margin:0" }, "Подключения"),
      el("a", { class: "ghost", href: "/api/client.zip", style: "font-size:13px" }, "⬇ клиент для Claude"),
    ]),
    el("div", { class: "row", style: "gap:8px;margin-top:8px;flex-wrap:wrap" },
      connRows.length ? connRows : [el("span", { class: "muted" }, "Пока никто не подключался по MCP")]),
  ]);

  // --- Лента действий ---
  const feedRows = feed.slice(0, 12).map((f) => el("div", { style: "padding:3px 0;font-size:13px" }, [
    el("span", { class: "muted" }, new Date(f.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) + " "),
    el("b", {}, f.actor + " "),
    f.action + (f.product_id ? " · " : ""),
    f.product_id ? el("a", { href: `#/p/${f.product_id}` }, f.product_id) : null,
  ]));
  const feedPanel = feed.length ? el("div", { class: "panel" }, [
    el("h2", { style: "margin:0 0 6px" }, "Последние действия"), ...feedRows,
  ]) : null;

  const head = el("div", { class: "row", style: "align-items:center;margin-bottom:16px" }, [
    el("h2", { style: "margin:0;color:var(--blue);flex:1" }, `Продукты (${products.length})`),
    el("button", { class: "ghost", onclick: createProduct }, "+ Вручную"),
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
    el("div", { class: "hint" }, "Продуктов пока нет. Скажи Claude: «создай продукт …» — он появится здесь.");

  app.innerHTML = "";
  app.append(connPanel);
  if (feedPanel) app.append(feedPanel);
  app.append(head, empty || grid);
}

async function createProduct() {
  const name = prompt("Название продукта:", "Новый продукт");
  if (!name) return;
  const { id } = await api.post("/api/products", { name });
  toast("Продукт создан");
  location.hash = `#/p/${id}`;
}

// ---------- карточка продукта (стадии «Карточка» и «Продукт») ----------
// stage: "card" — юр. предпосылки, правообладатель, права, финансы (внешние факты —
// чекбоксы); "product" — описание, класс, публичная страница, контакты, тех. поля.
// Обе стадии правят один и тот же объект product; сохраняется он целиком, поэтому
// поля другой стадии не теряются. Чек-лист справа обновляется из данных после сохранения.
async function viewProduct(id, stage) {
  stage = stage === "product" ? "product" : "card";
  const { product } = await api.get(`/api/products/${id}`);
  const classesRef = stage === "product" ? await api.get("/api/reference/classes").catch(() => null) : null;
  const tracker = await loadTracker(id);
  const egrulStatus = await api.get("/api/egrul/status").catch(() => ({ enabled: false }));
  const prepState = stage === "product" ? await api.get("/api/prepare/status").catch(() => null) : null;
  const p = product.product || {};

  // Плоские поля формы: [путь, подпись, тип, подсказка?, стадия]. Тип "bool" — чекбокс
  // (внешний факт: УКЭП/ЕСИА/ЕНС/ПП325/цепочка прав). classmulti/multi/list — как раньше.
  const ALL_FIELDS = [
    // --- стадия «Карточка» ---
    ["rightholder.orgName", "Правообладатель", "text", null, "card"],
    ["rightholder.inn", "ИНН", "text", null, "card"],
    ["rightholder.ogrn", "ОГРН", "text", null, "card"],
    ["rightholder.address", "Адрес правообладателя", "text", null, "card"],
    ["rightholder.ruControlSharePercent", "Доля РФ-контроля, %", "number", "требование > 50%", "card"],
    ["rightholder.signatory.hasUKEP", "УКЭП на руководителя получена", "bool", "внешний факт", "card"],
    ["rightholder.esiaConfirmed", "Учётная запись организации подтверждена в ЕСИА", "bool", "внешний факт", "card"],
    ["rightholder.noEnsDebt", "Нет задолженности на ЕНС > 3000 ₽", "bool", "внешний факт", "card"],
    ["rights.basis", "Основание прав", "select:rospatent,internal_docs", null, "card"],
    ["rights.depSubmitted", "Депонирование подано в Роспатент (ждём свидетельство)", "bool", "Схема B", "card"],
    ["rights.rospatentCertificateNumber", "№ свидетельства Роспатента", "text", "после регистрации", "card"],
    ["rights.rospatentCertificateDate", "Дата свидетельства (ГГГГ-ММ-ДД)", "text", null, "card"],
    ["rights.chainOfTitleComplete", "Цепочка прав оформлена (договоры, задания, акты)", "bool", null, "card"],
    ["rights.authors", "Авторы (ФИО через запятую)", "list", "для реферата и цепочки прав", "card"],
    ["compliance.pp325Checked", "Доптребования ПП № 325 сверены", "bool", "если применимо к классу", "card"],
    ["finance.annualRevenueProduct", "Выручка по продукту за год", "number", null, "card"],
    ["finance.annualForeignPayments", "Выплаты иностранцам за год", "number", null, "card"],
    // --- стадия «Продукт» ---
    ["product.name", "Наименование", "text", null, "product"],
    ["product.shortName", "Короткое имя", "text", null, "product"],
    ["product.deliveryType", "Модель поставки", "select:SaaS,on-prem,hybrid", null, "product"],
    ["product.guiLanguage", "Язык интерфейса", "select:ru,en", null, "product"],
    ["product.productPageUrl", "URL страницы продукта", "text", null, "product"],
    ["product.pricingUrl", "URL прайса / порядка ценообразования", "text", null, "product"],
    ["product.class", "Класс(ы) ПО", "classmulti", "выберите из списка · подкласс СВЕРИТЬ", "product"],
    ["product.description", "Описание функциональных характеристик", "textarea", null, "product"],
    ["product.purpose", "Назначение / область применения", "textarea", null, "product"],
    ["product.programmingLanguages", "Языки программирования (через запятую)", "list", null, "product"],
    ["product.expertDemo.url", "URL демо-доступа для эксперта", "text", "для SaaS", "product"],
    ["product.expertDemo.login", "Демо — логин", "text", null, "product"],
    ["product.expertDemo.password", "Демо — пароль", "text", null, "product"],
    ["support.contactFio", "Контакт ТП — ФИО", "text", "из профиля", "product"],
    ["support.contactEmail", "Контакт ТП — email", "text", "из профиля", "product"],
    ["support.contactPhone", "Контакт ТП — телефон", "text", "из профиля", "product"],
    ["support.lifecycleDocUrl", "URL документации жизненного цикла", "text", null, "product"],
    ["tech.supportedOS", "Поддерживаемые ОС", "multi:Astra Linux|РЕД ОС|Alt Linux|ROSA|МСВСфера|Windows", null, "product"],
    ["tech.databases", "СУБД", "multi:PostgreSQL|Postgres Pro|ClickHouse|YDB|Tarantool|Ред База Данных|встроенная (SQLite/файловая)|не используется", null, "product"],
    ["tech.infraLocation", "Локация инфраструктуры", "select:RU,иное", null, "product"],
    ["registration.deviceType", "Тип ЭВМ (для госрегистрации ПрЭВМ)", "text", "Госуслуги / ФИПС", "product"],
    ["registration.yearCreated", "Год создания", "text", "Госуслуги / ФИПС", "product"],
    ["registration.gisComponent", "Является компонентом ГИС", "bool", "Госуслуги / ФИПС", "product"],
  ];
  const fields = ALL_FIELDS.filter((f) => f[4] === stage);

  function getVal(pathStr) {
    return pathStr.split(".").reduce((o, k) => (o == null ? o : o[k]), product);
  }
  function setVal(pathStr, val) {
    const keys = pathStr.split(".");
    let o = product;
    for (let i = 0; i < keys.length - 1; i++) { o[keys[i]] = o[keys[i]] || {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = val;
  }

  function fieldNode([pathStr, label, type, hint]) {
    const cur = getVal(pathStr);
    let input, extra = null, labelStyle = "";
    if (type === "bool") {
      labelStyle = "grid-column:1 / -1";
      const cb = el("input", { type: "checkbox", "data-path": pathStr, "data-bool": "1",
        ...(cur === true ? { checked: "checked" } : {}) });
      const kids = [cb, el("span", {}, label)];
      if (hint) kids.push(el("span", { class: "tag" }, hint));
      return el("label", { class: "field chk-field", style: labelStyle }, kids);
    } else if (type.startsWith("select:")) {
      const opts = type.slice(7).split(",");
      input = el("select", { "data-path": pathStr },
        opts.map((o) => el("option", { value: o, ...(o === cur ? { selected: "selected" } : {}) }, o)));
    } else if (type === "classmulti") {
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
    if (pathStr === "rightholder.inn" && egrulStatus && egrulStatus.enabled) {
      extra = el("button", { class: "ghost", type: "button", style: "margin-top:4px",
        onclick: (ev) => egrulFill(ev.target) }, "Заполнить по ИНН");
    }
    const spanKids = [el("span", {}, label)];
    if (hint) spanKids.push(el("span", { class: "tag" }, hint));
    return el("label", { class: "field", style: labelStyle },
      [el("span", { style: "display:block;margin-bottom:4px" }, spanKids), input, extra]);
  }

  // Базовые поля — на виду; вторичные (реквизиты-дубли, демо-логин/пароль, доп. описания)
  // — под «Дополнительно», чтобы не удлинять форму. Ни одно из них не влияет на чек-лист.
  const EXTRA_PATHS = new Set([
    "rightholder.ogrn", "rightholder.address",
    "rights.rospatentCertificateDate", "rights.authors",
    "product.shortName", "product.programmingLanguages",
    "product.expertDemo.login", "product.expertDemo.password",
  ]);
  const form = el("div", { class: "two-col" }, fields.filter((f) => !EXTRA_PATHS.has(f[0])).map(fieldNode));
  const extraFieldsList = fields.filter((f) => EXTRA_PATHS.has(f[0]));

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
      setField("rightholder.address", data.address);
      const st = data.status && data.status !== "ACTIVE" ? ` · статус: ${data.status}` : "";
      toast(`Реквизиты подставлены — проверьте и сохраните${st}`);
    } catch (e) {
      toast(e.message || "Не удалось получить данные", true);
    } finally { btn.disabled = false; btn.textContent = t0; }
  }

  // Применяет ЧЕРНОВИК из «Мастера подготовки» к полям формы (не сохраняет).
  function applyDraft(draft) {
    const patch = (draft && draft.patch) || {};
    const flat = {};
    (function walk(obj, pre) {
      for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith("_")) continue;
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

  // Сохраняет карточку. Собирает только поля текущей стадии (в DOM), пишет их в общий
  // объект product и сохраняет его целиком. После — обновляет чек-лист; если стадия
  // только что закрылась, ведёт на следующую (авто-переход по такту).
  const wasComplete = !!(tracker && tracker.stages.find((s) => s.id === stage) || {}).complete;
  async function save() {
    app.querySelectorAll("[data-path]").forEach((inp) => {
      let v;
      if (inp.getAttribute("data-bool")) {
        v = !!inp.checked;
      } else if (inp.getAttribute("data-multi")) {
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
    const t2 = await loadTracker(id);
    const st = t2 && t2.stages.find((s) => s.id === stage);
    if (st && st.complete && !wasComplete && t2.nextStageId && t2.nextStageId !== stage) {
      const next = t2.stages.find((s) => s.id === t2.nextStageId);
      toast(`Стадия «${st.title}» закрыта → ${next.title}`);
      location.hash = `#/p/${id}${next.link || ""}`;
      return;
    }
    toast("Сохранено");
    viewProduct(id, stage);
  }

  const stageTitle = stage === "product" ? "Продукт — описание и публикация" : "Карточка — правообладатель, права, финансы";
  const panelKids = [
    el("h2", {}, stageTitle),
    form,
    extraFieldsList.length
      ? help("➕ Дополнительные поля (необязательно)", [el("div", { class: "two-col" }, extraFieldsList.map(fieldNode))])
      : null,
    el("div", { class: "row", style: "margin-top:8px" }, [
      el("button", { onclick: save }, "Сохранить"),
      el("button", { class: "danger", onclick: async () => {
        if (confirm("Удалить продукт со всеми данными?")) { await api.del(`/api/products/${id}`); location.hash = "#/"; }
      } }, "Удалить"),
    ]),
  ];
  if (stage === "product") panelKids.push(classesReference(classesRef));

  const main = [el("div", { class: "panel" }, panelKids)];
  if (stage === "product") main.push(prepWizard(id, prepState, applyDraft));

  const crumbLabel = stage === "product" ? "Продукт" : "Карточка";
  renderShell(id, stage, tracker, p.name || id, crumbLabel, main);
}

// ---------- проверки ----------
async function viewChecks(id) {
  const { product } = await api.get(`/api/products/${id}`);
  const name = (product.product && product.product.name) || id;
  const { report } = await api.get(`/api/products/${id}/report`);
  const { artifacts } = await api.get(`/api/products/${id}/artifacts`);
  const tracker = await loadTracker(id);

  // Артефакты, которые питают проверки (SBOM/HAR); документы депонирования (dep_/rights_) — на «Документах».
  const checkArtifacts = artifacts.filter((a) => !/^(dep_|rights_)/i.test(a.name));
  const artList = el("div", {}, checkArtifacts.length
    ? checkArtifacts.map((a) => el("div", { class: "meta mono" }, `• ${a.name} (${a.size} б)`))
    : [el("div", { class: "muted" }, "нет загруженных артефактов")]);
  const harAutoBtn = el("button", { class: "ghost", onclick: collectHarAuto }, "🌐 Собрать HAR автоматически");
  const harAutoMsg = el("div", { class: "muted", style: "font-size:12px;margin-top:6px" });

  const artPanel = el("div", { class: "panel" }, [
    el("h2", {}, "Артефакты для проверок"),
    el("div", { class: "hint", html: "Загрузите два файла из вашего продукта — по ним пройдут проверки лицензий и сетевого аудита (стадия «Артефакты и проверки»). <b>SBOM</b> собирает «Мастер подготовки» на стадии «Продукт»; <b>HAR</b> снимается в браузере (см. ниже) либо автоматически." }),
    el("div", { class: "row", style: "gap:8px" }, [
      uploader(id, "sbom", "SBOM", null, () => viewChecks(id)),
      uploader(id, "har", "HAR", null, () => viewChecks(id)),
      harAutoBtn,
    ]),
    harAutoMsg,
    el("div", { class: "spacer" }), artList,
    el("div", { class: "spacer" }),
    harHelp(),
  ]);

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
  renderShell(id, "checks", tracker, name, "Проверки", [artPanel, panel]);
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

// ---------- документы ----------
// Глубокое слияние патча автозаполнения в карточку: объекты — рекурсивно,
// скаляры и массивы — заменой (как deepMerge в mcp/server.js).
function deepMergeObj(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      target[k] = (target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) ? target[k] : {};
      deepMergeObj(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

async function viewDocs(id, forcePrep) {
  const { product } = await api.get(`/api/products/${id}`);
  const name = (product.product && product.product.name) || id;
  const { artifacts } = await api.get(`/api/products/${id}/artifacts`);
  const tracker = await loadTracker(id);

  // Подготовка пройдена = есть хоть один сгенерированный роспатентный артефакт.
  // До этого показываем ТОЛЬКО мастер (путь → диагностика → результат), без пустых таблиц.
  const hasPrepArtifacts = artifacts.some((a) => /^dep_(snapshot|referat|codefrag|statement)_/i.test(a.name));
  const prepared = hasPrepArtifacts && !forcePrep;

  // --- Мастер: один экран «источник + кнопка» ---
  // Платформа может работать на сервере, поэтому «путь на этом ПК» больше не главный
  // сценарий. Источники по надёжности: ZIP с любого ПК → git-ссылка → путь на сервере.
  const wizZip = el("input", { type: "file", accept: ".zip", style: "width:100%" });
  const wizPath = el("input", { type: "text", value: "",
    placeholder: "https://github.com/org/repo.git  или  /opt/projects/app", style: "width:100%" });
  const wizNotes = el("textarea", { placeholder:
    "Не обязательно: пара фраз о программе (что делает, для кого) — попадёт в реферат.",
    style: "width:100%;min-height:56px" });
  const wizProgress = el("div", { class: "muted", style: "font-size:12px;margin-top:8px" });
  const isGitUrl = (s) => /^https?:\/\//i.test(s) || /^git@/i.test(s);
  async function runWizard(btn) {
    const zipFile = wizZip.files && wizZip.files[0];
    const src = wizPath.value.trim();
    if (!zipFile && !src) { toast("Выбери ZIP проекта или укажи git-ссылку", true); return; }
    btn.disabled = true; const t0 = btn.textContent; btn.textContent = "Готовлю…";
    const step = (s) => { wizProgress.textContent = s; };
    try {
      step("1/3 — читаю код, делаю снимок версии…");
      let patch = null;
      if (zipFile) {
        // ZIP уезжает на сервер сырым телом; заметки — в query.
        const buf = await zipFile.arrayBuffer();
        const q = wizNotes.value ? `?notes=${encodeURIComponent(wizNotes.value)}` : "";
        const resp = await api.request("POST", `/api/products/${id}/autofill${q}`, buf, true);
        patch = resp.draft && resp.draft.patch;
      } else if (isGitUrl(src)) {
        // Git-ссылку клонирует сам сервер.
        await api.post(`/api/products/${id}/prepare`, { repo: src });
      } else {
        // Путь на машине, где запущена платформа (локальный запуск / папка на сервере).
        const resp = await api.post(`/api/products/${id}/autofill`, { path: src, notes: wizNotes.value });
        patch = resp.draft && resp.draft.patch;
      }
      if (patch && Object.keys(patch).length) {
        const fresh = (await api.get(`/api/products/${id}`)).product;
        deepMergeObj(fresh, patch);
        await api.put(`/api/products/${id}`, { product: fresh });
      }
      step("2/3 — генерирую документы (фрагмент кода, реферат)…");
      const errs = [];
      // Порядок важен: dep_codefrag фиксирует язык из листинга в карточку (и удаляет
      // сырьё), поэтому реферат генерируем после него — с уже заполненным языком.
      for (const kind of ["dep_snapshot", "dep_codefrag", "dep_referat"]) {
        try { await api.post(`/api/products/${id}/depon/${kind}`); }
        catch (e) { errs.push(`${kind}: ${e.message}`); }
      }
      step("3/3 — собираю монтажный лист…");
      await api.post(`/api/products/${id}/rospatent/autofill`).catch(() => {});
      toast("Готово — комплект для Госуслуг собран");
      errs.forEach((m) => toast(m, true));
      viewDocs(id);
    } catch (e) {
      wizProgress.textContent = "";
      toast(e.message || "Не удалось подготовить", true);
      btn.disabled = false; btn.textContent = t0;
    }
  }
  const wizBtn = el("button", { onclick: (e) => runWizard(e.currentTarget) }, "▶ Подготовить к подаче");
  const wizardPanel = el("div", {}, [
    el("div", { class: "hint" },
      "Загрузи ZIP с исходным кодом (или дай git-ссылку) — платформа сама сделает снимок версии, " +
      "фрагмент кода, реферат и заявление, и покажет поля для формы на Госуслугах. " +
      "Больше ничего заполнять не нужно."),
    el("label", { class: "field" }, [
      el("span", { style: "display:block;margin-bottom:4px" }, "ZIP-архив проекта (надёжный способ с любого ПК)"), wizZip]),
    el("label", { class: "field" }, [
      el("span", { style: "display:block;margin-bottom:4px" },
        "…или git-ссылка / путь к папке на сервере платформы"), wizPath]),
    el("label", { class: "field" }, [
      el("span", { style: "display:block;margin-bottom:4px" }, "Коротко о программе (не обязательно)"), wizNotes]),
    el("div", { class: "row", style: "margin-top:6px" }, [wizBtn]),
    wizProgress,
  ]);

  if (!prepared) {
    // MCP-first: главный путь — сказать Claude «подготовь к Роспатенту». Мастер
    // остаётся запасным ходом (нет Claude под рукой / хочется руками) — за спойлером.
    const mcpHint = el("div", { class: "panel" }, [
      el("h2", { style: "margin:0 0 8px" }, "Подача в Роспатент"),
      el("div", { class: "hint" },
        "Скажи Claude: «подготовь этот продукт к Роспатенту, репозиторий …» — " +
        "платформа сделает снимок версии, фрагмент кода, реферат и поля для Госуслуг. " +
        "Готовые документы появятся здесь."),
      el("details", { class: "help" }, [
        el("summary", {}, "Подготовить вручную (без Claude)"),
        el("div", { class: "body" }, [wizardPanel]),
      ]),
    ]);
    renderShell(id, "depon", tracker, name, "Документы", [mcpHint]);
    return;
  }

  // Внутреннее сырьё авто-подготовки (листинг для фрагмента) не показываем и не считаем документом.
  const isDeponRaw = (name) => /^dep_codefrag_listing\.txt$/i.test(name);

  // --- Монтажный лист «Госрегистрация ПрЭВМ» (Госуслуги / ФИПС) ---
  const { rospatent: G } = await api.get(`/api/products/${id}/rospatent`);
  const gCopy = (text) => el("button", { class: "ghost", onclick: async () => {
    const ok = await copy(String(text)); toast(ok ? "Скопировано" : "Не удалось скопировать", !ok);
  } }, "Копировать");
  const gRows = G.fields.map((f) => el("tr", {}, [
    el("td", { style: "width:34%" }, [
      el("b", {}, f.label),
      f.note ? el("div", { class: "tag" }, f.note) : null,
    ]),
    el("td", { class: "mono", style: "white-space:pre-wrap" }, String(f.value)),
    el("td", { style: "width:1%" }, gCopy(f.value)),
  ]));
  const gOver = G.referatLen > G.referatLimit;
  const gReferat = el("div", { style: "margin-top:10px" }, [
    el("div", { class: "row", style: "align-items:center;margin-bottom:4px" }, [
      el("b", { style: "flex:1" }, "Реферат (шаг 2, ≤ 900 символов)"),
      el("span", { class: gOver ? "tag" : "muted", style: gOver ? "color:var(--fail)" : "" },
        `${G.referatLen}/${G.referatLimit}`),
      el("button", { class: "ghost", style: "margin-left:8px", onclick: async () => {
        const ok = await copy(G.referat); toast(ok ? "Скопировано" : "Не удалось скопировать", !ok);
      } }, "Копировать"),
    ]),
    el("textarea", { readonly: "readonly",
      style: "width:100%;min-height:130px;font-family:Consolas,monospace;font-size:12px" }, G.referat),
  ]);
  const gosuslugiPanel = el("div", { class: "panel" }, [
    el("div", { class: "row", style: "align-items:center;margin-bottom:8px" }, [
      el("h2", { style: "flex:1;margin:0" }, "Госуслуги: госрегистрация ПрЭВМ"),
    ]),
    el("table", {}, [
      el("tr", {}, [el("th", {}, "Поле"), el("th", {}, "Значение"), el("th", {}, "")]),
      ...gRows,
    ]),
    gReferat,
  ]);

  // --- Блок 2: «Скачай и приложи» — что грузить на Госуслуги, а что хранить у себя ---
  const FILE_LABELS = {
    dep_snapshot: "Снимок кода + акт фиксации версии",
    dep_referat: "Реферат программы",
    dep_codefrag: "Фрагмент исходного кода",
    dep_statement: "Заявление (шпаргалка значений)",
    dep_cert: "Свидетельство о госрегистрации",
  };
  // В заявку на Госуслугах идут только идентифицирующие материалы (ст. 1262 ГК):
  // реферат + фрагмент кода. Снимок/акт — доказательство версии, хранится у себя.
  const UPLOAD_KINDS = new Set(["dep_referat", "dep_codefrag"]);
  const dlRows = artifacts
    .filter((a) => !isDeponRaw(a.name) && /^dep_(snapshot|referat|codefrag|statement|cert)_/i.test(a.name))
    .map((a) => {
      const key = (a.name.match(/^dep_[a-z]+/i) || [""])[0].toLowerCase();
      return { a, key, forUpload: UPLOAD_KINDS.has(key) };
    })
    .sort((x, y) => Number(y.forUpload) - Number(x.forUpload))
    .map(({ a, key, forUpload }) => el("tr", {}, [
      el("td", { style: "width:1%;white-space:nowrap" },
        forUpload
          ? el("span", { class: "tag", style: "color:var(--ok, #2e7d32);border-color:currentColor;font-weight:600" }, "→ в заявку")
          : el("span", { class: "muted" }, "для себя")),
      el("td", {}, FILE_LABELS[key] || key),
      el("td", {}, el("a", { href: `/api/products/${id}/artifacts/file/${encodeURIComponent(a.name)}` },
        "⬇ " + a.name.slice(key.length + 1))),
      el("td", { class: "muted", style: "width:1%;white-space:nowrap" }, `${Math.round((a.size || 0) / 1024)} КБ`),
    ]));
  const filesPanel = el("div", { class: "panel" }, [
    el("div", { class: "row", style: "align-items:center;margin-bottom:8px" }, [
      el("h2", { style: "flex:1;margin:0" }, "Скачай и приложи к заявке"),
      el("button", { class: "ghost", onclick: async () => {
        try { await api.post(`/api/products/${id}/artifacts/open-folder`); }
        catch (e) { toast(e.message || "Не удалось открыть папку", true); }
      } }, "📂 Открыть папку"),
    ]),
    el("table", {}, [el("tr", {}, [el("th", {}, "Документ"), el("th", {}, "Файл"), el("th", {}, "")]), ...dlRows]),
    el("div", { class: "row", style: "margin-top:10px;align-items:center;gap:8px" }, [
      el("span", { class: "muted" }, "Пришло свидетельство из Роспатента?"),
      uploader(id, "dep_cert", "PDF", ".pdf,.png,.jpg,.jpeg", () => viewDocs(id)),
    ]),
  ]);

  renderShell(id, "depon", tracker, name, "Роспатент", [gosuslugiPanel, filesPanel]);
}

// ---------- отправка (монтажный лист подачи) ----------
async function viewSubmit(id) {
  const { submission } = await api.get(`/api/products/${id}/submission`);
  const S = submission;
  const { product, rights: rightsInfo } = await api.get(`/api/products/${id}`);
  const rState = (rightsInfo && rightsInfo.state) || "draft";
  const rReady = rState === "transfer_registered";
  const tracker = await loadTracker(id);
  const main = [];

  // Гейт Схемы B: подача в Минцифру возможна только когда переход права зарегистрирован в ФИПС.
  if (!rReady) {
    main.push(el("div", { class: "panel", style: "border-color:var(--fail)" }, [
      el("b", { style: "color:var(--fail)" }, "Подача в Минцифру заблокирована"),
      el("div", { class: "muted", style: "margin-top:4px" },
        "Цепочка прав не замкнута. На стадии «Документы» получи свидетельство Роспатента, оформи отчуждение " +
        "(договор + акт) и зарегистрируй переход права в ФИПС (ст. 1232). Текущий статус права: «" + ((rightsInfo && rightsInfo.meta && rightsInfo.meta.label) || rState) + "»."),
    ]));
  }

  main.push(el("div", { class: "hint", html:
    "Готовые значения для формы карточки ПО на <span class='mono'>reestr.digital.gov.ru</span>. " +
    "Копируй по полям и вставляй в портал. Значения с «СВЕРИТЬ» проверь перед подачей." }));

  // Список незакрытых пунктов не дублируем — он всегда виден в сайдбаре-чеклисте справа.

  // --- Отметка об отправке (внешний факт: заявление подано на портале) ---
  // Заблокирована, пока право не отчуждено ООО (Схема B).
  const sentCb = el("input", { type: "checkbox",
    ...(rReady ? {} : { disabled: "disabled" }),
    ...(product.submission && product.submission.sentToPortal ? { checked: "checked" } : {}) });
  sentCb.addEventListener("change", async () => {
    product.submission = product.submission || {};
    product.submission.sentToPortal = sentCb.checked;
    await api.put(`/api/products/${id}`, { product });
    toast(sentCb.checked ? "Отмечено: отправлено на портал" : "Снята отметка");
    viewSubmit(id);
  });
  main.push(el("div", { class: "panel" }, [
    el("label", { class: "chk" }, [sentCb,
      el("span", {}, " Заявление отправлено на проверку на reestr.digital.gov.ru (закрывает стадию «Подача»)")]),
  ]));

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

  main.push(el("div", { class: "panel" }, [
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
  main.push(el("div", { class: "panel" }, [
    el("h2", {}, "Документы к прикреплению"),
    el("div", { class: "muted", style: "font-size:12px;margin-bottom:8px" },
      "«готово» — сформировано платформой; «вручную» — подготовить и приложить самостоятельно."),
    el("table", {}, [
      el("tr", {}, [el("th", {}, "Документ"), el("th", {}, "Статус"), el("th", {}, "")]),
      ...attRows,
    ]),
  ]));

  // --- Сценарий подачи ---
  main.push(el("div", { class: "panel" }, [
    el("h2", {}, "Порядок отправки на портале"),
    el("ol", {}, S.steps.map((s) => el("li", { style: "margin:4px 0" }, s))),
    el("div", { class: "muted", html:
      `Готовность по маршруту: <b>${S.readiness.percent}%</b> · проверки: ${badge(S.readiness.checksOverall)}. ` +
      "Пошлина 0 ₽. Срок цикла — ориентировочно 1–3 мес. (СВЕРИТЬ)." }),
  ]));

  renderShell(id, "submit", tracker, S.productName, "Отправка", main);
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
    ["author.fullName", "Автор (физлицо) — ФИО", "text"],
    ["author.birthDate", "Автор — дата рождения", "text"],
    ["author.citizenship", "Автор — гражданство", "text"],
    ["author.snils", "Автор — СНИЛС", "text"],
    ["author.address", "Автор — адрес места жительства", "text"],
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
      "<b>автоматически подставляться</b> в каждый новый продукт. В карточке продукта значения можно переопределить.<br>" +
      "<b>Автор (физлицо)</b> — на него оформляется депонирование в Роспатенте; затем право отчуждается организации-правообладателю." }),
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
      "<li>Проходить маршрут по стадиям; чек-лист справа закрывается сам из данных карточки, артефактов и проверок.</li>" +
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
// Таблица markdown: строка "| a | b |", затем строка-разделитель "| --- | --- |".
function isTableRow(line) { return /^\s*\|.*\|\s*$/.test(line); }
function isTableRule(line) { return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line); }
function splitTableRow(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}
function mdToHtml(md) {
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  const lines = String(md).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    if (/^#{1,6}\s/.test(line)) {
      closeList();
      const lvl = line.match(/^(#{1,6})/)[1].length;
      out.push(`<h${lvl}>${mdInline(line.replace(/^#{1,6}\s+/, ""))}</h${lvl}>`);
    } else if (isTableRow(line) && isTableRule((lines[i + 1] || ""))) {
      closeList();
      const header = splitTableRow(line);
      i += 2;
      const bodyRows = [];
      while (i < lines.length && isTableRow(lines[i])) { bodyRows.push(splitTableRow(lines[i])); i++; }
      i--;
      out.push("<table>", "<thead><tr>" + header.map((c) => `<th>${mdInline(c)}</th>`).join("") + "</tr></thead>", "<tbody>");
      for (const row of bodyRows) out.push("<tr>" + row.map((c) => `<td>${mdInline(c)}</td>`).join("") + "</tr>");
      out.push("</tbody></table>");
    } else if (/^---+$/.test(line)) {
      closeList(); out.push("<hr>");
    } else if (/^>\s?/.test(line)) {
      closeList(); out.push(`<p class="md-note">${mdInline(line.replace(/^>\s?/, ""))}</p>`);
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
// Разбивает markdown на разделы по заголовкам "## " (верхнеуровневые h1 "# "
// не делят — считаются общим заголовком страницы). Возвращает [{title, id, md}].
function splitMdSections(md) {
  const lines = String(md).split(/\r?\n/);
  const sections = [];
  let cur = { title: "Общее", id: "intro", body: [] };
  for (const line of lines) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) {
      if (cur.body.some((l) => l.trim() !== "")) sections.push(cur);
      const title = m[1].replace(/[⚠️🆕]/g, "").trim();
      const id = "sec-" + title.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      cur = { title: m[1].trim(), id, body: [] };
    } else if (/^#\s+/.test(line)) {
      cur.body.push(line.replace(/^#\s+/, ""));
    } else {
      cur.body.push(line);
    }
  }
  if (cur.body.some((l) => l.trim() !== "")) sections.push(cur);
  return sections;
}

async function viewNormative() {
  app.innerHTML = "";
  const panel = el("div", { class: "panel normative" }, [el("p", {}, "Загрузка нормативного справочника…")]);
  app.append(panel);
  try {
    const md = await api.get("/api/reference/normative");
    const sections = splitMdSections(md);
    const toc = el("nav", { class: "normative-toc" }, [
      el("div", { class: "normative-toc-title" }, "Разделы"),
      ...sections.map((s) => {
        const a = el("a", { href: "#" + s.id }, s.title);
        a.addEventListener("click", (e) => {
          e.preventDefault();
          document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        return a;
      }),
    ]);
    const content = el("div", { class: "normative-content" },
      sections.map((s) => el("section", { id: s.id, class: "normative-section", html: mdToHtml(s.body.join("\n")) }))
    );
    panel.innerHTML = "";
    panel.append(el("div", { class: "normative-layout" }, [toc, content]));
  } catch (e) {
    panel.innerHTML = "";
    panel.append(
      el("h2", {}, "Справочник недоступен"),
      el("p", {}, "Не удалось загрузить normative.md: " + (e && e.message || "ошибка")),
    );
  }
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

// ---------- источники (собранные ссылки на документацию) ----------
async function viewSources() {
  app.innerHTML = "";
  const panel = el("div", { class: "panel glossary" }, [el("p", {}, "Загрузка источников…")]);
  app.append(panel);
  try {
    const md = await api.get("/api/reference/sources");
    panel.innerHTML = mdToHtml(md);
  } catch (e) {
    panel.innerHTML = "";
    panel.append(
      el("h2", {}, "Источники недоступны"),
      el("p", {}, "Не удалось загрузить список источников: " + (e && e.message || "ошибка")),
    );
  }
}

})();
