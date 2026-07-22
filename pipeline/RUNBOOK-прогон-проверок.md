# RUNBOOK — быстрый прогон нового продукта через проверки Реестра

Практический путь «от репозитория до зелёного отчёта». Универсален для любого
проекта. Сначала — как гнать, потом — **известные грабли** (реальные стоп-факторы и
ложные срабатывания, уже встречавшиеся на живых проектах) с готовыми решениями.

Связан с: `README.md` (общий пайплайн), `02_checks/` (сами проверки),
`product.example.json` (карточка).

---

## 0. Быстрый прогон (TL;DR)

```bash
# 1. карточка
cp pipeline/product.example.json pipeline/product.json   # заполнить под продукт

# 2. артефакты (см. §2) кладём рядом, пути прописываем в product.json:
#    tech.sbomFile, tech.networkEvidenceFile

# 3. прогон проверок
node pipeline/02_checks/run_checks.js pipeline/product.json
#    → консоль + 02_checks/last_report.md. Пока есть FAIL — на портал не идём.

# 4. досье (после того как FAIL закрыты)
node pipeline/03_docs/gen_dossier.js pipeline/product.json   # .docx в 03_docs/out/
```

---

## 1. Что вообще проверяется (5 авто-проверок, гейт G3)

| Проверка | Модуль | Критерий PASS | Поле-источник |
| --- | --- | --- | --- |
| Правило 30% | `foreign_payments` | доля иностранных выплат < 30% выручки продукта | `finance.*` |
| Лицензии OSS | `license_scan` | нет GPL/AGPL-заражения и «без лицензии» в SBOM | `tech.sbomFile` |
| Сетевой аудит | `network_audit` | нет обязательных обращений за рубеж | `tech.networkEvidenceFile` |
| Страница продукта | `page_check` | `productPageUrl` задан, абсолютный http(s); `guiLanguage=ru` | `product.*` |
| Реквизиты | `requisites` | корректные ИНН/ОГРН по контрольным суммам ФНС | `rightholder.*` |

Статусы: **PASS** (ок) · **WARN** (не блокер, глазами подтвердить) · **FAIL** (блокер) · **SKIP** (нет данных).

---

## 2. Сбор артефактов

- **SBOM** (для `license_scan`): CycloneDX JSON.
  ```bash
  FETCH_LICENSE=true npx --yes @cyclonedx/cdxgen@latest -t javascript -o sbom.json
  ```
  Путь → `tech.sbomFile`, формат → `tech.sbomFormat: "CycloneDX"`.

- **Сетевое доказательство** (для `network_audit`): HAR **или** упрощённый JSON.
  - HAR: DevTools → Network → «Save all as HAR» на **рабочем** экземпляре.
  - или `{ "urls": ["https://...", ...] }` — список фактических хостов.
  Путь → `tech.networkEvidenceFile`.
  Снимать трафик нужно с **боевого** прод-URL — dev-сборка может тянуть лишнее.

- **Финансы** (правило 30%): `finance.annualRevenueProduct`, `finance.annualForeignPayments`.
- **Реквизиты**: `rightholder.inn`, `rightholder.ogrn`.
- **Публичная страница**: `product.productPageUrl` (абсолютный, http/https), `product.guiLanguage: "ru"`.

---

## 3. Известные грабли (реальные, с решениями)

### 3.1. Гигантские медиа в git HEAD → снимок режется лимитом
Снимок исходников строится через `git archive HEAD` и **читает закоммиченные** файлы
(а не рабочую директорию), поэтому задним числом `.gitignore` уже закоммиченные блобы
не убирает. Если в HEAD сотни МБ медиа (`public/images`, `data`, `*.tar.gz`) — снимок
упрётся в лимит (`REESTR_MAX_SNAPSHOT_MB`, дефолт 300 МБ).

**Решение — чистый ZIP только исходников:**
```bash
git archive --format=zip -o src_clean.zip HEAD -- . \
  ':(exclude)*.tar.gz' ':(exclude)data/**' \
  ':(exclude)public/images/**' ':(exclude)public/tasks/**'
```
Загрузить этот ZIP как снимок. (Радикально — почистить историю `git rm --cached` + BFG,
но это отдельное решение и согласуется с владельцем репо.)

> Платформенный баг, уже исправлен: `http-util.js` резал **любое** тело запроса на 25 МБ
> (`MAX_BODY`) → ZIP > 25 МБ рвал сокет (http=000). Теперь ZIP-маршрут берёт лимит из
> `localsource.MAX_ZIP_BYTES` (300 МБ). Если увидите мгновенный обрыв на большом ZIP — проверьте это.

### 3.2. `license_scan`: ложный FAIL на dual-license
SPDX-выражения имеют семантику: `OR` = лицензиат выбирает (берём **лучшую**),
`AND` = соблюдать все (берём **худшую**), `WITH` = лицензия+исключение (правит лицензия).
Раньше проверка трактовала `OR` как `AND` → пакет `(MIT OR GPL-3.0-or-later)` (напр. `jszip`)
давал ложный FAIL.

**Исправлено** — `license_scan.js` парсит выражение с приоритетом `WITH > AND > OR`.
Настоящие GPL/AGPL/«без лицензии» по-прежнему ловятся. Если сомнительный вердикт —
смотрите конкретный компонент в `last_report.md`, а не общий статус.

### 3.3. `requisites`: ложный FAIL на ИНН физлица/ИП
Контрольные суммы ФНС различаются: **10 цифр** — юрлицо (1 контрольная),
**12 цифр** — физлицо/ИП/самозанятый (2 контрольные); ОГРН **13**, ОГРНИП **15**.
Раньше принимался только 10-значный ИНН и 13-значный ОГРН.

**Исправлено** — поддержаны 12-значный ИНН и 15-значный ОГРНИП.
Если правообладатель — ИП/самозанятый, 12-значный ИНН теперь проходит.

### 3.4. `network_audit`: Google Fonts = стоп-фактор
`@import url("https://fonts.googleapis.com/...")` в CSS → обязательное обращение к
`fonts.googleapis.com` + `fonts.gstatic.com` при каждом старте → **FAIL**.

**Решение — self-host шрифта** (не трогая компоненты):
1. Скачать woff2 всех подмножеств с gstatic (UA современного браузера) в `public/fonts/`.
2. Локальный `@font-face` в отдельном `fonts.css`, `src` → `/fonts/...`.
3. В глобальном CSS заменить внешний `@import` на `@import "./fonts.css"`.
Глобальное правило `* { font-family: "Manrope" }` продолжает работать без изменений.

Проверка после фикса: `grep -rnE "fonts\.(googleapis|gstatic)\.com" src public` → пусто.

### 3.5. `mc.yandex.com` → WARN (не блокер)
Яндекс.Метрика на `.com`-домене (cookie-sync) даёт WARN «неизвестный внешний хост».
Яндекс — РФ-юрисдикция, это **не** стоп-фактор. Подтвердить вручную либо (платформенно)
добавить `yandex.com` в `ALLOWED_SUFFIXES` (`02_checks/lib/rules.js`).

### 3.6. Секреты в git (`.env.local`)
Часто в репо закоммичен `.env.local` с ИНН/телефоном/почтой/ключами платёжки
(`YOOKASSA_SHOP_ID` и т.п.). Это не ломает проверки, но: **вынести из git,
добавить в `.gitignore`**, реальные данные правообладателя брать не из плейсхолдеров.

---

## 4. Чек-лист «готов к подаче» (G3)

- [ ] `product.json` заполнен, `guiLanguage: "ru"`, `productPageUrl` — боевой абсолютный URL.
- [ ] SBOM собран, `license_scan` = PASS/WARN (нет GPL/AGPL/no-license FAIL).
- [ ] Сетевое доказательство с **боевого** URL, `network_audit` без FAIL (self-host шрифтов и т.п.).
- [ ] Реквизиты реального правообладателя, `requisites` = PASS.
- [ ] Правило 30% посчитано (`finance.*`), не SKIP.
- [ ] Секреты вынесены из git.
- [ ] `last_report.md` без единого FAIL.
