const path = require("path");
const fs = require("fs");
const GP = "C:\\Users\\Andrey\\AppData\\Roaming\\npm\\node_modules";
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, TableOfContents, HeadingLevel,
  BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak,
} = require(path.join(GP, "docx"));

// ---------- helpers ----------
const FONT = "Arial";
const BLUE = "1F4E79";
const LIGHT = "D9E2F3";
const GREY = "CCCCCC";

function H1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}
function H2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
}
function H3(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(text)] });
}
function P(runs, opts = {}) {
  const children = Array.isArray(runs) ? runs : [new TextRun(runs)];
  return new Paragraph({ children, spacing: { after: 120, line: 276 }, ...opts });
}
function bullet(runs, level = 0) {
  const children = Array.isArray(runs) ? runs : [new TextRun(runs)];
  return new Paragraph({ numbering: { reference: "bul", level }, spacing: { after: 60, line: 264 }, children });
}
function check(runs, level = 0) {
  const children = Array.isArray(runs) ? runs : [new TextRun(runs)];
  return new Paragraph({ numbering: { reference: "chk", level }, spacing: { after: 60, line: 264 }, children });
}
function num(runs) {
  const children = Array.isArray(runs) ? runs : [new TextRun(runs)];
  return new Paragraph({ numbering: { reference: "ord", level: 0 }, spacing: { after: 60, line: 264 }, children });
}
function R(text, opts = {}) { return new TextRun({ text, ...opts }); }
function B(text) { return new TextRun({ text, bold: true }); }

// callout / note box (single-cell table)
function note(title, lines, fill = "FCE4D6") {
  const kids = [new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: title, bold: true })] })];
  lines.forEach((l) => kids.push(new Paragraph({ spacing: { after: 40, line: 264 }, children: Array.isArray(l) ? l : [new TextRun(l)] })));
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({ children: [new TableCell({
      width: { size: 9360, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 120, bottom: 120, left: 160, right: 160 },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 6, color: "E8A33D" },
        bottom: { style: BorderStyle.SINGLE, size: 6, color: "E8A33D" },
        left: { style: BorderStyle.SINGLE, size: 18, color: "E8A33D" },
        right: { style: BorderStyle.SINGLE, size: 6, color: "E8A33D" },
      },
      children: kids,
    })] })],
  });
}

// generic table
function tbl(colWidths, headerCells, rows, headerFill = BLUE) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: GREY };
  const borders = { top: border, bottom: border, left: border, right: border };
  const mkCell = (content, w, opts = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    ...opts,
    children: (Array.isArray(content) ? content : [content]).map((c) =>
      typeof c === "string"
        ? new Paragraph({ children: [new TextRun(c)] })
        : c),
  });
  const headerRow = new TableRow({
    tableHeader: true,
    children: headerCells.map((h, i) => mkCell(
      new Paragraph({ children: [new TextRun({ text: h, bold: true, color: "FFFFFF" })] }),
      colWidths[i],
      { shading: { fill: headerFill, type: ShadingType.CLEAR } },
    )),
  });
  const bodyRows = rows.map((r, ri) => new TableRow({
    children: r.map((cell, ci) => mkCell(
      typeof cell === "string"
        ? new Paragraph({ children: [new TextRun(cell)] })
        : cell,
      colWidths[ci],
      ri % 2 === 1 ? { shading: { fill: "F2F6FB", type: ShadingType.CLEAR } } : {},
    )),
  }));
  return new Table({
    width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...bodyRows],
  });
}
function sp(after = 120) { return new Paragraph({ spacing: { after } }); }

// ---------- document ----------
const children = [];

// Title block
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 2200, after: 120 },
  children: [new TextRun({ text: "АНАЛИТИЧЕСКАЯ ЗАПИСКА", bold: true, size: 44, color: BLUE })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 80 },
  children: [new TextRun({ text: "Стратегия включения программных продуктов", size: 30, color: "404040" })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 80 },
  children: [new TextRun({ text: "в Единый реестр российского ПО (Минцифры)", size: 30, color: "404040" })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 60, after: 600 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 8 } },
  children: [new TextRun({ text: "для подготовки линейки продуктов к закупкам по 44-ФЗ и 223-ФЗ", italics: true, size: 22, color: "606060" })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { before: 400, after: 60 },
  children: [new TextRun({ text: "Внутренний рабочий документ", size: 22, color: "606060" })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 60 },
  children: [new TextRun({ text: "Дата подготовки: 23.06.2026", size: 22, color: "606060" })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: "Статус: ДСП / для внутреннего использования", size: 22, color: "606060" })],
}));

// Disclaimer on title page
children.push(sp(300));
children.push(note(
  "Оговорка о достоверности",
  [
    "Документ подготовлен на основе нормативной базы: 188-ФЗ (ст. 12.1 149-ФЗ), Постановление Правительства РФ № 1236 от 16.11.2015, ПП РФ № 325 от 23.03.2017 и приказов Минцифры.",
    [B("Числовые значения процедурных сроков и перечни доптребований к классам ПО подлежат обязательной сверке"), R(" с действующей редакцией ПП № 1236 и регламентом на reestr.digital.gov.ru непосредственно перед подачей: правила менялись в 2023–2025 гг.")],
  ],
  "FFF2CC",
));

children.push(new Paragraph({ children: [new PageBreak()] }));

// TOC
children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Содержание")] }));
children.push(new TableOfContents("Оглавление", { hyperlink: true, headingStyleRange: "1-2" }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// ===== Нормативная база =====
children.push(H1("Нормативная база и термины"));
children.push(P([B("Опорные нормативные акты:")]));
children.push(bullet([B("ст. 12.1 ФЗ № 149-ФЗ"), R(" (введена 188-ФЗ) — запрет закупки иностранного ПО при наличии аналога в реестре;")]));
children.push(bullet([B("ПП РФ № 1236 от 16.11.2015"), R(" — правила формирования и ведения реестра, классификатор, требования к ПО;")]));
children.push(bullet([B("ПП РФ № 325 от 23.03.2017"), R(" — доптребования к офисному ПО, ОС и СУБД (если применимо);")]));
children.push(bullet([R("приказы Минцифры — регламент рассмотрения заявлений и состав экспертного совета.")]));
children.push(P([B("Терминология: "), R("«реестр отечественного ПО» = Единый реестр российских программ для ЭВМ и баз данных (ведёт Минцифры). Существует также реестр ЕАЭС; для целей 44-ФЗ ключевым является российский реестр.")]));

// ===== БЛОК 1 =====
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(H1("Блок 1. Три пути вхождения в реестр"));
children.push(note(
  "Юридическая ремарка",
  [
    [R("Формально в ПП № 1236 — "), B("единая процедура подачи"), R(". «Три пути» — это не три регламента, а три сценария прохождения одной процедуры в зависимости от качества предварительной подготовки правовой базы.")],
    [R("«Ускорение» достигается не через привилегированный канал, а через "), B("снятие оснований для дополнительных запросов экспертного совета"), R(" — каждый запрос приостанавливает течение срока.")],
  ],
));

children.push(H2("Путь 1 — Оптимальный (минимизация запросов экспертизы)"));
children.push(P([B("Суть: "), R("до подачи формируется «несокрушимая» доказательная база права, чтобы у эксперта не возникло вопросов по самому уязвимому критерию — принадлежности исключительного права.")]));
children.push(P([B("Механизм:")]));
children.push(num([B("Госрегистрация программы для ЭВМ в Роспатенте"), R(" (ст. 1262 ГК РФ) → свидетельство. Не обязательное условие реестра, но публичный правоподтверждающий документ с приоритетной датой, принимаемый экспертом без проверки цепочки авторства.")]));
children.push(num([B("Депонирование исходного кода"), R(" (аккредитованный депозитарий / нотариус / сервис фиксации) → фиксирует контрольную сумму, дату и содержание кода. Страховка для Пути 3.")]));
children.push(num([B("Полная цепочка передачи прав: "), R("трудовые договоры + служебные задания + акты на служебные произведения (ст. 1295 ГК РФ), либо договоры авторского заказа / отчуждения.")]));
children.push(P([B("Эффект: "), R("заявка проходит формальную и содержательную проверку без приостановок. Самый быстрый фактический путь.")]));
children.push(note(
  "Корректировка ожиданий",
  [
    [R("«Ускоренного экспертного совета по факту депонирования» в ПП № 1236 "), B("нет"), R(". Роспатент/депонирование сокращают срок не процедурно, а статистически — устраняя 1–2 круга запросов. "), B("Не закладывайте в план обещание гарантированного fast-track.")],
  ],
));

children.push(H2("Путь 2 — Средний (стандартная подача без депонирования)"));
children.push(P([B("Суть: "), R("право подтверждается внутренними документами компании (трудовые договоры, служебные задания, локальные акты), без свидетельства Роспатента и депонирования.")]));
children.push(P([B("Базовые этапы по регламенту:")]));
children.push(num([R("Подача заявления через reestr.digital.gov.ru, подпись УКЭП.")]));
children.push(num([B("Формальная (комплектная) проверка"), R(" Минцифры — комплектность, корректность класса, доступность страницы продукта. "), new TextRun({ text: "(срок подлежит сверке; ориентир — несколько рабочих дней)", italics: true })]));
children.push(num([B("Содержательная экспертиза"), R(" — оценка соответствия требованиям ПП № 1236.")]));
children.push(num([B("Экспертный совет"), R(" — коллегиальное решение (рекомендовать / отказать / запросить доработку).")]));
children.push(num([B("Приказ Минцифры"), R(" о включении.")]));
children.push(P([B("Сроки: "), R("ориентировочно 1–3 месяца общего цикла при отсутствии запросов "), new TextRun({ text: "(подлежит сверке)", italics: true }), R(". Каждый запрос эксперта приостанавливает течение срока.")]));
children.push(P([B("Риск: "), R("при «тонкой» доказательной базе эксперт вправе запросить пояснения по правообладанию или доле иностранных компонентов → сценарий съезжает к Пути 3.")]));

children.push(H2("Путь 3 — Сложный (углублённый аудит при сомнениях в самостоятельности)"));
children.push(P([B("Триггеры перехода: "), R("сомнения, что продукт является самостоятельным произведением, а не надстройкой/ребрендингом стороннего (часто иностранного open-source) решения; несоответствие класса; вопросы к доле иностранных выплат; «клонирование» уже зарегистрированного продукта.")]));
children.push(P([B("Что проверяется углублённо:")]));
children.push(bullet([B("Код и архитектура: "), R("соотношение собственной и заимствованной кодовой базы, состав внешних зависимостей, проприетарные иностранные SDK, факты обращения к зарубежной инфраструктуре в рантайме.")]));
children.push(bullet([B("Правоустанавливающие документы: "), R("полная цепочка от каждого разработчика до правообладателя; договоры с подрядчиками; лицензии на все сторонние компоненты.")]));
children.push(bullet([B("Финансовая модель: "), R("структура лицензионных платежей иностранным лицам относительно выручки (критерий 30%, см. Блок 2).")]));
children.push(P([B("Защита: "), R("здесь окупаются артефакты Пути 1 — депонированный код, SBOM и юридическое заключение о лицензионной чистоте. Их наличие переводит «аудит подозрения» в «аудит подтверждения».")]));
children.push(P([B("Сроки: "), R("непрогнозируемы; цикл «запрос-ответ» может растянуть процесс на 3–6+ месяцев; возможен мотивированный отказ с правом повторной подачи.")]));

children.push(sp(120));
children.push(H3("Сравнительная таблица путей"));
children.push(tbl(
  [1700, 2900, 2200, 2560],
  ["Параметр", "Путь 1 — Оптимальный", "Путь 2 — Средний", "Путь 3 — Сложный"],
  [
    ["Подготовка права", "Роспатент + депонирование + полная цепочка", "Внутренние документы компании", "Запрашивается весь архив + аудит"],
    ["Риск запросов", "Минимальный", "Средний", "Высокий (инициируется экспертом)"],
    ["Ориент. срок", "Быстрее всего", "1–3 мес.", "3–6+ мес."],
    ["Затраты «на входе»", "Выше (пошлины, депозит)", "Базовые", "Реактивные, непрогнозируемые"],
    ["Рекомендация", "По умолчанию для всей линейки", "Для простых продуктов с чистым правом", "Сценарий-риск, не выбирается осознанно"],
  ],
));

// ===== БЛОК 2 =====
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(H1("Блок 2. Технические «гардрейлы» (чек-лист защиты)"));

children.push(H2("2.1. Критическая корректировка: «правило 30%» — это НЕ доля кода"));
children.push(P([R("В исходной постановке смешаны два разных требования. Их необходимо развести — от этого зависит вся стратегия обоснования.")]));
children.push(tbl(
  [2400, 4360, 2600],
  ["Критерий", "Что это", "Порог"],
  [
    [
      new Paragraph({ children: [new TextRun({ text: "Финансовый (реальное требование реестра)", bold: true })] }),
      "Сумма выплат по лицензионным/иным договорам в пользу иностранных правообладателей за права на ПО и его компоненты (ПП № 1236)",
      new Paragraph({ children: [new TextRun({ text: "< 30% выручки правообладателя от реализации этого ПО за год", bold: true })] }),
    ],
    [
      new Paragraph({ children: [new TextRun({ text: "«Доля собственного кода 30%»", bold: true })] }),
      "Расхожая интерпретация. Жёсткого норматива «≥ X% строк собственного кода» в ПП № 1236 нет",
      "Оценивается экспертом качественно",
    ],
  ],
));
children.push(P([B("Вывод для стратегии:")]));
children.push(bullet([R("Юридически обязателен "), B("финансовый"), R(" порог: годовые платежи иностранным лицам за компоненты — "), B("строго менее 30%"), R(" годовой выручки по продукту. Считается и подтверждается бухгалтерски.")]));
children.push(bullet([R("«Самостоятельность произведения» (ст. 1259–1260 ГК РФ) эксперт оценивает не по проценту строк, а по тому, является ли продукт самостоятельной/составной/производной работой с творческим вкладом. Open-source библиотеки допустимы; ключ — продукт должен быть собственным произведением, а не чужим с заменой бренда.")]));
children.push(P([B("Как обосновывать:")]));
children.push(check([R("Бухгалтерская справка: выплаты иностранным лицензиарам / выручка по продукту < 30% (за отчётный год).")]));
children.push(check([R("Архитектурная записка: что является ядром продукта (ваша разработка), а что — инфраструктурными зависимостями (СУБД, фреймворк, библиотеки).")]));
children.push(check([R("Свидетельство Роспатента + депонирование как доказательство самостоятельности и состава кода.")]));
children.push(check([R("Для SaaS: подтверждение, что бизнес-логика, модель данных, UI/UX — собственная разработка, а не конфигурация чужой платформы.")]));

children.push(H2("2.2. Внешние зависимости и локализация инфраструктуры"));
children.push(P([R("Принцип ПП № 1236: ПО "), B("не управляется и не обновляется принудительно из-за пределов РФ"), R(", а сопровождение ведётся российским лицом без иностранного контроля. На практике — жёсткий технический чек-лист.")]));
children.push(P([new TextRun({ text: "Запрещено (must-fix перед подачей):", bold: true, color: "C00000" })]));
children.push(check([B("Зарубежные CDN"), R(" для шрифтов, иконок, CSS/JS (Google Fonts, cdnjs, jsDelivr, unpkg) → перенести на собственный/российский хостинг, бандлить локально.")]));
children.push(check([B("Иностранная аналитика/телеметрия"), R(" (Google Analytics, GTM, Hotjar, Sentry на зарубежных серверах, Facebook Pixel) → заменить на российские (Яндекс.Метрика на инфраструктуре РФ / self-hosted) или убрать.")]));
children.push(check([B("Рантайм-обращения к зарубежным API"), R(" как критическая зависимость работоспособности (внешние LLM-API, геокодеры, карты, платёжные SDK иностранных вендоров в ядре).")]));
children.push(check([B("Автообновления/license heartbeat"), R(", обращающиеся к серверам за пределами РФ.")]));
children.push(check([B("Контейнерные образы и пакеты"), R(", тянущиеся в рантайме с зарубежных registry без локального зеркала.")]));
children.push(P([new TextRun({ text: "Требуется обеспечить:", bold: true, color: "375623" })]));
children.push(check([R("Серверная инфраструктура продакшена (для SaaS — критично) размещена в "), B("ЦОД на территории РФ"), R(".")]));
children.push(check([R("Техподдержка, гарантийное обслуживание и модернизация — "), B("российским юрлицом без преобладающего иностранного участия"), R("; зафиксировано регламентом ТП и контактами в РФ.")]));
children.push(check([R("Локализованные зеркала репозиториев зависимостей (внутренний proxy/Nexus).")]));
children.push(check([R("Сетевой аудит: трассировка исходящих соединений работающего продукта — подтвердить отсутствие обязательных коннектов за рубеж.")]));
children.push(note(
  "Особый риск для SaaS",
  [
    [R("Проверяющий открывает рабочий экземпляр и DevTools → панель "), B("Network"), R(" не должна показывать обязательных запросов к зарубежным доменам.")],
  ],
  "FFF2CC",
));

children.push(H2("2.3. Чистота Open Source (аудит лицензий)"));
children.push(P([R("Цель — исключить компоненты, чьи лицензии (а) несовместимы с проприетарным распространением или (б) накладывают copyleft-обязательства раскрытия исходного кода.")]));
children.push(tbl(
  [2200, 3760, 3400],
  ["Категория", "Примеры лицензий", "Действие"],
  [
    [
      new Paragraph({ children: [new TextRun({ text: "Низкий риск (permissive)", bold: true, color: "375623" })] }),
      "MIT, BSD-2/3, Apache-2.0, ISC, Zlib",
      "Допустимо. Соблюдать атрибуцию; для Apache-2.0 учесть патентную оговорку",
    ],
    [
      new Paragraph({ children: [new TextRun({ text: "Средний риск (weak copyleft)", bold: true, color: "BF8F00" })] }),
      "LGPL, MPL-2.0, EPL",
      "Допустимо при динамической линковке/изоляции компонента; статическая линковка в проприетарное ядро — риск",
    ],
    [
      new Paragraph({ children: [new TextRun({ text: "Высокий риск (strong copyleft)", bold: true, color: "C00000" })] }),
      new Paragraph({ children: [new TextRun({ text: "GPL-2.0, GPL-3.0, AGPL-3.0", bold: true })] }),
      "Заражают производный продукт обязательством раскрытия. AGPL особенно опасна для SaaS — триггерит обязательства даже при предоставлении ПО как сервиса по сети",
    ],
    [
      new Paragraph({ children: [new TextRun({ text: "Критический", bold: true, color: "C00000" })] }),
      "«No-license», SSPL, BSL, CC-NC (запрет коммерческого использования), санкционные вендоры",
      "Исключить полностью",
    ],
  ],
));
children.push(P([B("Чек-лист аудита:")]));
children.push(check([R("Сформировать "), B("SBOM"), R(" (SPDX или CycloneDX) — полную опись компонентов и транзитивных зависимостей.")]));
children.push(check([R("Прогнать лиценз-сканер (FOSSA / ScanCode / OSS Review Toolkit / средства CI) по всему дереву, включая транзитивные зависимости.")]));
children.push(check([R("Устранить любые "), B("GPL/AGPL"), R(" в составе ядра проприетарного продукта.")]));
children.push(check([R("Проверить отсутствие компонентов от санкционных/ушедших вендоров и компонентов «без лицензии».")]));
children.push(check([R("Подготовить NOTICE/атрибуцию для permissive-лицензий.")]));
children.push(check([R("Юридическое заключение о лицензионной чистоте — приложить в досье к Пути 3.")]));

// ===== БЛОК 3 =====
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(H1("Блок 3. Пошаговая инструкция для ответственного сотрудника"));

children.push(H2("Этап 0. Предпосылки (до начала работы в системе)"));
children.push(check([R("Правообладатель — российское юрлицо; "), B("суммарная доля прямого/косвенного участия РФ, субъектов, муниципалитетов и граждан РФ > 50%"), R(". Проверить по выписке ЕГРЮЛ и структуре владения.")]));
children.push(check([R("Получена "), B("УКЭП"), R(" на руководителя или уполномоченное лицо.")]));
children.push(check([R("Учётная запись организации подтверждена в "), B("ЕСИА (Госуслуги)"), R(".")]));
children.push(check([R("Определён "), B("класс ПО"), R(" по классификатору ПП № 1236 (ошибка класса = возврат на формальной проверке).")]));
children.push(check([R("Проверено, не подпадает ли продукт под "), B("доптребования"), R(" (ПП № 325; требования совместимости с российскими ОС/процессорами для отдельных классов — "), new TextRun({ text: "подлежит сверке", italics: true }), R(").")]));

children.push(H2("Этап 1. Пакет документов (подготовить заранее)"));
children.push(H3("Правоустанавливающие"));
children.push(check([R("Документы на исключительное право: свидетельство Роспатента (рекомендуется) "), B("или"), R(" комплект «трудовой договор + служебное задание + акт на служебное произведение» по каждому разработчику; договоры авторского заказа/отчуждения с подрядчиками.")]));
children.push(check([R("Выписка ЕГРЮЛ, учредительные документы, документы о структуре владения (подтверждение российского контроля).")]));
children.push(check([R("Бухгалтерская справка: доля выплат иностранным правообладателям < 30% выручки по продукту.")]));
children.push(H3("Технические"));
children.push(check([R("Описание функциональных характеристик ПО.")]));
children.push(check([R("Документация: руководство пользователя и администратора, описание процессов установки и эксплуатации.")]));
children.push(check([R("Описание процессов поддержания жизненного цикла, гарантийного обслуживания и техподдержки (выполняются в РФ).")]));
children.push(check([R("Экземпляр ПО / тестовый доступ для эксперта (для SaaS — демо-стенд с учётной записью).")]));
children.push(check([R("SBOM и заключение о лицензионной чистоте open-source.")]));
children.push(check([R("(Опционально, Путь 1) свидетельство о депонировании кода.")]));

children.push(H2("Этап 2. Требования к странице продукта (сайту)"));
children.push(P([R("Проверяющий должен с этой страницы самостоятельно изучить продукт "), B("без оплаты и без регистрации у вас"), R(".")]));
children.push(check([R("Постоянно доступный публичный URL (без paywall и обязательной авторизации для доступа к документации).")]));
children.push(check([R("Размещены: описание функциональных характеристик, инструкция по установке/получению доступа, руководство по эксплуатации, описание процессов жизненного цикла и порядка техподдержки.")]));
children.push(check([R("Контакты техподдержки в РФ.")]));
children.push(check([B("Самопроверка инфраструктуры (критично): "), R("открыть страницу и рабочий экземпляр → DevTools → Network → убедиться в отсутствии обязательных запросов к зарубежным CDN/аналитике/API. Шрифты/скрипты — локальные.")]));
children.push(check([R("Сайт хостится на инфраструктуре в РФ.")]));

children.push(H2("Этап 3. Прохождение на портале — до кнопки «Отправить документы на проверку»"));
children.push(num([B("Авторизация: "), R("reestr.digital.gov.ru → вход через ЕСИА под учётной записью организации (уполномоченное лицо).")]));
children.push(num([B("Создать заявление"), R(" на включение сведений о ПО в реестр.")]));
children.push(num([B("Заполнить карточку ПО: "), R("наименование, класс, правообладатель, описание функциональных характеристик, URL страницы продукта.")]));
children.push(num([B("Приложить документы"), R(" из Этапа 1 (правоустанавливающие + технические) в требуемых форматах.")]));
children.push(num([B("Указать сведения о соответствии"), R(" требованиям ПП № 1236 (исключительное право, отсутствие иностранного контроля, доля выплат < 30%, локализация ТП, отсутствие принудительного управления из-за рубежа).")]));
children.push(num([B("Указать данные для доступа эксперта"), R(" к экземпляру (для SaaS — демо-доступ).")]));
children.push(num([B("Внутренняя проверка комплектности: "), R("все поля заполнены, все вложения приложены, страница продукта доступна из режима инкогнито.")]));
children.push(num([B("Подписать заявление УКЭП.")]));
children.push(num([new TextRun({ text: "Нажать «Отправить документы на проверку».", bold: true })]));

children.push(H2("Этап 4. После отправки (контроль сотрудником)"));
children.push(bullet([R("Отслеживать статус в личном кабинете.")]));
children.push(bullet([R("На запросы эксперта отвечать в установленный срок — иначе заявление приостанавливается/отклоняется.")]));
children.push(bullet([R("При мотивированном отказе — устранить замечания и подать повторно (отказ не лишает права повторной подачи).")]));

// ===== РЕЗЮМЕ =====
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(H1("Резюме для руководства"));
children.push(num([B("Стратегия по умолчанию — Путь 1"), R(" для всей линейки: затраты на Роспатент + депонирование + SBOM окупаются предсказуемостью сроков и страховкой от перехода в углублённый аудит.")]));
children.push(num([B("Главный технический риск — SaaS-продукты"), R(" из-за рантайм-зависимостей и зарубежной аналитики/CDN. Сетевой аудит исходящего трафика обязателен до подачи.")]));
children.push(num([B("«30%» — это финансовый критерий выплат иностранным лицам, а не доля кода."), R(" Готовить бухгалтерское подтверждение; самостоятельность произведения обосновывать архитектурно.")]));
children.push(num([B("Open-source: блокеры — GPL/AGPL"), R(" (AGPL критична для SaaS). Лиценз-аудит всего дерева зависимостей до подачи.")]));

children.push(sp(200));
children.push(note(
  "Обязательно сверить перед подачей (онлайн-источники недоступны на момент подготовки)",
  [
    "• Актуальная редакция ПП № 1236 и точные процедурные сроки этапов;",
    "• действующие доптребования по совместимости с российскими ОС/процессорами для классов ваших продуктов;",
    "• актуальный перечень и форматы документов в АИС «Реестр» на момент подачи.",
  ],
  "FFF2CC",
));

// ---------- assemble ----------
const doc = new Document({
  creator: "IT-юридический отдел",
  title: "Аналитическая записка: вхождение в реестр российского ПО",
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: FONT, color: BLUE },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 25, bold: true, font: FONT, color: "2E5496" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: FONT, color: "404040" },
        paragraph: { spacing: { before: 140, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bul", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 600, hanging: 280 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1080, hanging: 280 } } } },
      ] },
      { reference: "chk", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "☐", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 600, hanging: 320 } } } },
      ] },
      { reference: "ord", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 600, hanging: 320 } } } },
      ] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GREY, space: 4 } },
        children: [new TextRun({ text: "Аналитическая записка · Реестр российского ПО (Минцифры)", size: 16, color: "808080" })],
      })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "ДСП · стр. ", size: 16, color: "808080" }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "808080" }),
          new TextRun({ text: " из ", size: 16, color: "808080" }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "808080" }),
        ],
      })] }),
    },
    children,
  }],
});

const OUT = "C:\\Disk D\\Project\\Mincifra\\Аналитическая_записка_Реестр_ПО_Минцифры.docx";
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("OK:", OUT, buf.length, "bytes");
});
