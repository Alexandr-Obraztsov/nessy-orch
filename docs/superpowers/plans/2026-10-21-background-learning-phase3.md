# Фоновое обучение, этап 3: окно «Фон» в приложении — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** в приложении TClaude-Orch видно и управляется всё фоновое обучение: что делают фоновые агенты сейчас, кейсы, плейбуки, журнал, настройки; кейс и плейбук правятся блоками и через чат; у сессии — чип загруженного плейбука и меню обучения.

**Architecture:** сервер этапов 1–2 уже отдаёт `GET /learning` и события SSE `learning_*`. Этап 3 добавляет на сервер несколько маршрутов для просмотра и правки блоками (задача 1), в `NessyKit` — модели, клиент и `LearningStore` (задача 2), в `NessyOrch` — отдельное окно «Фон» (сцена `Window`, как «Роли»), с разделами Работа · Кейсы · Плейбуки · Журнал · Настройки (задачи 3–6). Отдельное окно, а не пункт боковой панели: боковой панели сессий в приложении больше нет (одно окно — терминал проекта и панель агентов, `app/README.md`); вход — кнопка в шапке (значок только при ошибке или ожидании ревью), меню приложения и menu bar.

**Tech Stack:** TypeScript (сервер), Swift 6 / SwiftUI, macOS 26, SwiftPM (`NessyKit` тестируется `swift test`), дизайн-система `app/Sources/NessyOrch/DesignSystem.swift` (`DS.*`).

**Spec:** `docs/superpowers/specs/2026-10-18-background-learning-design.md` §5 (интерфейс), §4 (сбои), §6 (настройки), §3.8 (чат и заметки). Контракт: `shared/types/learning.ts`, `docs/api.md` (раздел «Фоновое обучение»).

## Global Constraints

- Интерфейс по-русски, без технических id в подписях (id — только в подсказках и меню «Скопировать id»).
- Анти-цели спеки: никаких всплывающих окон и ярких индикаторов при штатной работе; значок на кнопке «Фон» — **только** при ошибке задания или плейбуке/правке, ждущих человека.
- **Одна карточка на объект** с разделами в порядке чтения; полный текст раскрывается на месте; без россыпи окон и шторок.
- Правка блоками: добавить, удалить, переставить — шаг, источник, файл, правило, заметку; каждое сохранение — новая версия на сервере (откат в «Истории»).
- Удаление кейса и плейбука — с подтверждением, где сказано, что изменится (сколько правил теряют доказательство).
- Нет связи с оркестратором — окно показывает последнее известное состояние и строку «нет связи».
- Дизайн-система: только `DS.Palette`, `DS.Typography`, `DS.Metrics`, `DS.Motion`; кнопки — как в существующих панелях (`GlassIconButton`, `BarIcon`); тёмная и светлая темы; `reduceMotion`.
- Swift: стиль файлов `app/` (табы, комментарии по-русски, `@MainActor @Observable` для состояния); логика без UI — в `NessyKit` с тестами.
- Проверки: `npm run check` (сервер), `cd app && swift test`, `cd app && swift build`; сборка `.app` — `app/scripts/build-app.sh`.

## Review Focus

1. **Поток событий без снимка**: `learning_*` приходят до первого `GET /learning` или после переподключения SSE — состояние не должно дублироваться или откатываться; после `snapshot` (переподключение) `LearningStore` перечитывает `GET /learning` — тест в задаче 2.
2. **Длинные тексты** (описание сессии на 300 строк, плейбук с 15 этапами, ответ агента на 50 тыс. знаков) — списки ленивые, полный текст раскрывается на месте, окно не тормозит — проверка в задачах 4–5 на образцах.
3. **Правка блоками при параллельной работе фонового агента** (сервер ответил 409 `playbook_busy`/`case_busy`) — правка не теряется: черновик блока остаётся, строка «агент работает с плейбуком, сохраним после» и повтор — задачи 4–5.
4. **Неразобранный summary.md** (агент написал не по формату) — карточка кейса показывает текст как markdown, а не пустые разделы — тест разбора в задаче 2.
5. **Сервер без обучения** (`503 learning_unavailable`, старая версия сервера без маршрутов) — окно показывает понятную строку, остальное приложение работает — задача 3.

---

### Task 1: Сервер — маршруты просмотра и правки блоками

**Files:**
- Modify: `src/interfaces/http/routes/learning.routes.ts`, `src/application/learning/learning.service.ts`, `src/application/learning/playbook.service.ts`, `src/interfaces/http/parsers.ts`, `shared/types/learning.ts`, `docs/api.md`
- Test: `test/unit/application/learning-api.test.ts` (дополнить), `test/integration/learning-playbooks.test.ts` (дополнить)

**Interfaces (новые маршруты; не-GET — оператор):**

| Метод и путь | Ответ / действие |
|---|---|
| `GET /learning/jobs/:id` | `JobDetail { job: JobView; runs: Array<{ name: string; text: string }> }` — ответы агентов задания из `runs/` по порядку `k` |
| `GET /learning/cases/:id/raw?from=&to=` | `RawEvent[]` (из `raw/events.jsonl`; без `to` — до конца, не больше 500 событий) — для якоря «открыть место в сессии» |
| `PUT /learning/cases/:id/summary {text}` | правка описания кейса руками: пишет `summary.md` (курсор не трогает); 409 `case_busy`, если по кейсу `running`-задание |
| `PATCH /learning/playbooks/:id {title?, description?, params?, sources?, files?, behavior?, stages?, rules?}` | правка блоками: заменяет переданные поля содержания (`rules` — массив `{ id?: string; text: string; stage: number \| null }` — без `id` новое правило `candidate`, отсутствующие в массиве id → `archived`); `lintPlaybook(…, { strictEvidence: false })` — critical → 400 `lint` с текстами; иначе новая версия, журнал `edit`; 409 `playbook_busy` |
| `POST /learning/cases/:id/collector/stop` | остановить сборщика кейса: отменить `queued` и прервать `running`-задание кейса (`cancel` агента); кейс → `ready`, если есть описание, иначе удалить |
| `GET /learning/cases/:id/impact` | `{ rules: Array<{ playbookId: string; ruleId: string; text: string; evidenceLeft: number }> }` — что потеряет доказательство при удалении кейса (для диалога подтверждения) |

- `RawEvent`, `JobDetail` — в `shared/types/learning.ts` (`RawEvent` перенести из домена в контракт и реэкспортировать в домене, если удобнее).

- [ ] **Step 1: Тесты** (юнит на сервисах + интеграционный по HTTP): каждый маршрут — успех, 404 неизвестного id, 409 при занятом объекте; `PATCH` с удалением шага → новая версия, `files/stages/` без этого шага; `PATCH` с `description` без `Use when` → 400 `lint`; `raw?from=3&to=5` → 3 события; `impact` для кейса, который единственное доказательство правила, → `evidenceLeft: 1`.
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS; `docs/api.md` дополнен.
- [ ] **Step 3:** commit «Обучение, этап 3: маршруты просмотра и правки блоками».

### Task 2: NessyKit — модели, клиент, LearningStore

**Files:**
- Create: `app/Sources/NessyKit/LearningModels.swift`, `app/Sources/NessyKit/LearningStore.swift`, `app/Sources/NessyKit/CaseSummary.swift`
- Modify: `app/Sources/NessyKit/Models.swift` (`StreamEvent` + `Frame`), `app/Sources/NessyKit/OrchClient.swift`, `app/Sources/NessyKit/OrchStore.swift` (передача событий `learning_*` и `snapshot` в `LearningStore`)
- Test: `app/Tests/NessyKitTests/LearningTests.swift`

**Interfaces:**
- Модели `Codable, Sendable, Identifiable` — зеркало `shared/types/learning.ts` и задачи 1: `LearningSettings`, `CaseView`, `CaseDetail`, `CaseGoal`, `JobView`, `JobDetail`, `RawEvent`, `PlaybookView`, `PlaybookDetail`, `RuleView`, `PlaybookStage`, `PlaybookParam`, `PendingEdit`, `ReviewReport`, `StageReport`, `JournalEntry`, `ChatMessage`, `BackfillCandidate`, `BackfillResult`, `LearningView`. Перечисления статусов с `case unknown` для будущих значений (как у существующих моделей).
- `StreamEvent`: `.learningJob(JobView)`, `.learningCase(CaseView)`, `.learningCaseRemoved(String)`, `.learningSettings(LearningSettings)`, `.learningPlaybook(PlaybookView)`, `.learningPlaybookRemoved(String)`, `.learningJournal(JournalEntry)`, `.learningChat(subject: String, message: ChatMessage)`.
- `OrchClient` (`// MARK: обучение`): `learning()`, `patchLearningSettings(_:)` (тело — словарь изменённых полей), `runLearning(session:)`, `retryJob(_:)`, `job(_:)`, `caseDetail(_:)`, `caseRaw(_:from:to:)`, `caseImpact(_:)`, `deleteCase(_:)`, `rebuildCase(_:)`, `putCaseSummary(_:text:)`, `putCaseNotes(_:text:)`, `stopCollector(_:)`, `backfillCandidates()`, `backfill(ids:)`, `playbooks()`, `playbookDetail(_:)`, `patchPlaybook(_:_:)` (тело `PlaybookPatch` со всеми полями необязательными), `reviewPlaybook(_:)`, `approvePlaybook(_:)`, `rejectPlaybook(_:reason:)`, `setPlaybookStatus(_:_:)`, `revertPlaybook(_:version:)`, `deletePlaybook(_:)`, `putPlaybookNotes(_:text:)`, `acceptEdit(_:hash:)`, `rejectEdit(_:hash:)`, `journal(limit:)`, `revertJournal(_:)`, `chat(_:)`, `sendChat(_:text:)`. Ошибки — существующий `APIError` (`code` `learning_unavailable`, `playbook_busy`, `case_busy`, `lint` — отдельные свойства `isBusy`, `isUnavailable`).
- `LearningStore` (`@MainActor @Observable`): `settings`, `jobs`, `cases`, `playbooks`, `journal` (последние 200), `chats: [String: [ChatMessage]]`, `available: Bool` (false при `learning_unavailable` / 404 маршрута), `loaded: Bool`; `refresh() async` (`GET /learning`), `apply(_ e: StreamEvent)` (upsert/удаление; `.snapshot` → `Task { await refresh() }`); производные: `running`, `queued`, `failed` (задания `error`), `doneToday`, `needsHuman` (плейбуки `review` + `pendingEdits` у всех), `badge: Int` (`failed.count + needsHuman`), `cases(of status:)`, `caseOf(session: String) -> CaseView?` (по `sessions`), `playbookOf(session:) -> PlaybookView?` (через `case.playbook` `id@версия`), `sinceLastVisit(_ date: Date) -> (cases: Int, rulesActivated: Int, playbooks: Int)` по журналу и `closedAt`.
- `CaseSummary.parse(_ markdown: String) -> CaseSummary` — разбор `summary.md` по формату сборщика (`learning/prompts/session-collector.md`): `title`, `goals: [Goal { title; type; plan: [String]; actions: [Action { what; agent; result; anchor: ClosedRange<Int>? }]; sources: [String]; corrections: [Correction { proposed; user; anchor }]; open: [String] }]`, `unparsed: Bool` (нет ни одного `## Goal:` — карточка показывает текст как markdown). Строка действия `- <what> -> <agent, role> -> <result> (n a–b)`; разделитель `->` или `→`; без якоря — `anchor: nil`.
- `OrchStore` получает `public let learning: LearningStore` (создаётся с тем же клиентом) и в `apply` пересылает события `learning_*` и `snapshot`.

- [ ] **Step 1: Тесты** (`LearningTests.swift`): декодирование каждого кадра SSE `learning_*` (JSON-образцы из `docs/api.md`); `LossyArray`-устойчивость `GET /learning` к одной битой записи; `apply` — upsert задания, удаление кейса, журнал не растёт выше 200; `badge` = ошибки + ревью + правки; `snapshot` вызывает перечитывание (через фейковый клиент или флаг); `CaseSummary.parse` на образце из 2 целей (действия с якорями `n 3–7` и `n 12`, поправка, `- none`) и на тексте без `## Goal:` → `unparsed`; `sinceLastVisit`.
- [ ] **Step 2:** падают; реализовать; `cd app && swift test` — PASS, `swift build` — без ошибок.
- [ ] **Step 3:** commit «Приложение: модели, клиент и состояние фонового обучения».

### Task 3: Окно «Фон» — каркас, вход, раздел «Работа»

**Files:**
- Create: `app/Sources/NessyOrch/Background/BackgroundWindow.swift` (корень окна: `NavigationSplitView`, разделы), `Background/WorkSection.swift`, `Background/JobCard.swift`, `Background/LearningChat.swift` (общий чат объекта: лента `ChatMessage`, поле ввода, «изменено: …»), `Background/LearningComponents.swift` (общие: чипы источников, строка якоря с поповером `RawEvent`, заголовок карточки, раскрываемый блок текста, строка «нет связи»/«обучение недоступно»), заглушки `Background/CasesSection.swift`, `PlaybooksSection.swift`, `JournalSection.swift`, `LearningSettingsView.swift` (по одной строке `Text("…")` — их заменят задачи 4–6)
- Modify: `app/Sources/NessyOrch/NessyOrchApp.swift` (сцена `Window("Фон", id: "background")`, пункт меню «Фон…» с сочетанием), `app/Sources/NessyOrch/RootView.swift` (кнопка `BarIcon` в шапке рядом с «Роли»: значок `DSCount` только при `learning.badge > 0`), `app/Sources/NessyOrch/MenuBarPanel.swift` (строка «Фон: N в работе» и значок при `badge`), `app/Sources/NessyOrch/Hotkeys.swift` (действие `.background`), `app/Sources/NessyOrch/AppModel.swift` (запуск `store.learning.refresh()` при подключении), `app/README.md`

**Interfaces:**
- Разделы — `enum BackgroundSection: String, CaseIterable { case work, cases, playbooks, journal, settings }`, выбор помнится (`@SceneStorage`). Ссылка `nessy-orch://background/<раздел>[/<id>]` открывает окно на объекте (обработчик ссылок — там же, где `session`/`agent`).
- «Работа» (спека §5): строка «пока вас не было: …» (`sinceLastVisit` от отметки прошлого открытия окна, `UserDefaults`; одна тихая строка, исчезает по клику); «Сейчас» — карточки `running` (агент, сессия кейса — название сессии из `OrchStore`, шаг — вид задания по-русски: «Описание сессии», «Сопоставление», «Сборка плейбука», «Ревью: ступень N», «Судья», «Улучшение», «Правка из чата»; время работы); «Очередь» — список `queued` по порядку (ждёт пачку бэкфилла — подпись); «Ошибки» — `failed` с причиной и кнопкой «Повторить»; «Сделано сегодня» — счётчик, раскрывается списком.
- `JobCard` (раскрывается на месте): поручение и ответ агента — из `JobDetail.runs` (полный текст раскрывается); если агент жив (`store.agents[job.agentId]`), — живой чат существующим `AgentChat` (переиспользовать компонент окна агента) и кнопки «Остановить» (`client.cancel`) и «Открыть сессию» (`model.show(session:)` для кейсовых заданий).
- Состояния окна: `!available` — «Фоновое обучение недоступно на этом сервере»; `daemon` offline — данные остаются, сверху строка «нет связи».

- [ ] **Step 1:** `swift build` — сборка проходит с заглушками; отладочный флаг `-debug.openBackground work|cases|playbooks|journal|settings` (как прочие `-debug.*`) открывает окно на разделе.
- [ ] **Step 2: Проверка глазами**: `app/scripts/build-app.sh`, запуск с демо-сервером (`npm run demo` использует фейковый nessy; для фона — стенд с `ORCH_LEARNING_DEFAULT=1` и `fake-scenarios.json` с маркерами промптов, как в `test/integration/learning-playbooks.test.ts`), снимки окна «Фон» в светлой и тёмной теме (`screencapture -l <windowid>` или `-debug.appearance`), положить в `docs/design/screens/background-work-{light,dark}.png`.
- [ ] **Step 3:** `swift test`, `swift build` — PASS; commit «Приложение: окно «Фон», раздел «Работа»».

### Task 4: Раздел «Кейсы» и карточка кейса

**Files:**
- Modify: `app/Sources/NessyOrch/Background/CasesSection.swift`; Create: `Background/CaseCard.swift`, `Background/CaseEditor.swift`

**Interfaces / поведение (спека §5):**
- Список кейсов: фильтр по статусу (собирается / готов / ошибка), поиск по заголовку и целям, строка — заголовок, цели-типы чипами, сессии (названия), плейбук@версия, дата; сортировка по свежести.
- Карточка: шапка — заголовок, цели и типы, сессии (клик → `model.show(session:)`), плейбук@версия (клик → раздел «Плейбуки» на нём), статус; действия «Пересобрать» (`rebuildCase`), «Остановить сборщика» (если идёт), «Удалить» (диалог с `caseImpact`: «правило X потеряет доказательство»). Разделы по целям из `CaseSummary`: план; действия таблицей (что поручено, кому/роль, итог; строка раскрывает полный текст из `raw` по якорю; якорь — кнопка, поповер с событиями `caseRaw`); источники чипами; поправки карточками («предлагал → вы сказали»); открытые вопросы. `unparsed` — описание как markdown (`Markdown.swift`). Пока кейс собирается — плашка «описание дописывается» и разделы появляются по мере событий `learning_case`.
- Заметки — редактируемый список строк (добавить, удалить, переставить) → `putCaseNotes`. Правка описания блоками (`CaseEditor`): добавить/удалить/переставить пункты действий, источников, поправок, открытых вопросов внутри цели → сборка markdown обратно (функция `CaseSummary.render()` — добавить в NessyKit с тестом) → `putCaseSummary`; 409 `case_busy` → черновик остаётся, строка «сборщик работает, сохраню после» и автоповтор по событию `learning_job` кейса `done`.
- Чат кейса — `LearningChat(subject: case.id)`.

- [ ] **Step 1: Тест** `CaseSummary.render(parse(x)) == x` для образца формата сборщика (круговой разбор) — в `LearningTests.swift`.
- [ ] **Step 2:** реализовать; `swift test`, `swift build` — PASS; снимки `docs/design/screens/background-case-{light,dark}.png` (кейс из 2 целей).
- [ ] **Step 3:** commit «Приложение: кейсы и карточка кейса».

### Task 5: Раздел «Плейбуки» и карточка плейбука

**Files:**
- Modify: `app/Sources/NessyOrch/Background/PlaybooksSection.swift`; Create: `Background/PlaybookCard.swift`, `Background/PlaybookEditor.swift`, `Background/PlaybookReview.swift`

**Interfaces / поведение (спека §5):**
- Список: группы по статусу (ждут вас: `review` и с `pendingEdits` — сверху; активные; пробные — с прогрессом «1 из 3 кейсов»; черновики; выключенные и архив — свёрнуто), строка — название, тип задачи, версия, число кейсов, `▲▼` по правилам суммарно.
- Карточка — вкладки-разделы внутри одной карточки (сегменты сверху): **Обзор** (когда применять — description, параметры, источники, ключевые файлы, этапы со ссылкой «гейт: показать вам»; правка блоками — `PlaybookEditor`: добавить/удалить/переставить этап, источник, файл, параметр, пункт поведения → `patchPlaybook`; 400 `lint` — тексты замечаний под полем; 409 — черновик и автоповтор, как в задаче 4), **Кейсы** (кейсы сборки, отложенный, пробные с поправками; клик → карточка кейса), **Правила** (активные, кандидаты, архив; `▲▼`, доказательства — чипы кейсов с якорем; правка текста, добавить, удалить (= `archived`), перенос этапа → `patchPlaybook.rules`), **Заметки** (список строк → `putPlaybookNotes`), **Ревью** (`PlaybookReview`: последний отчёт — шесть ступеней с вердиктом, critical и notes; кнопки «Одобрить»/«Отклонить с причиной» для `review`; `pendingEdits` — «было → стало» с кейсом-источником и кнопками «Принять»/«Отклонить»; «Запустить ревью»), **История** (версии с сообщением и датой, «Откатить к этой» → `revertPlaybook`; дифф двух версий не делаем — показываем CHANGELOG версии), чат — `LearningChat(subject: playbook.id)` внизу карточки.
- Шапка: название, статус, версия, «Включить/Выключить», «Удалить» (подтверждение: «Claude перестанет загружать этот плейбук»).

- [ ] **Step 1:** реализовать; `swift test`, `swift build` — PASS; снимки `docs/design/screens/background-playbook-{light,dark}.png` (обзор и правила).
- [ ] **Step 2:** commit «Приложение: плейбуки и карточка плейбука».

### Task 6: Журнал, настройки, разбор прошлых, сессия

**Files:**
- Modify: `app/Sources/NessyOrch/Background/JournalSection.swift`, `Background/LearningSettingsView.swift`; Create: `Background/BackfillSheet.swift`; Modify: `app/Sources/NessyOrch/AgentPanel.swift` или файл шапки панели агентов сессии (найти, где шапка панели сессии: заголовок сессии и кнопки) — чип плейбука и меню «⋯»
- Test: `app/Tests/NessyKitTests/LearningTests.swift` (логика меню и настроек, если вынесена в NessyKit)

**Interfaces / поведение:**
- **Журнал**: лента `JournalEntry` по дням: время, вид по-русски («Плейбук собран», «Ревью пройдено», «Ревью не пройдено», «Опубликован», «Пробный режим пройден/не пройден», «Правило включено/в архиве», «Новая версия», «Откат», «Правка»), объект (клик → карточка), краткое `summary`; раскрытие показывает отчёт (`report` — JSON ревью → тот же вид, что «Ревью» в задаче 5); «Откатить» для `revertible && revertedBy == nil` (подтверждение) → `revertJournal`; откаченные — приглушены с подписью «откачено».
- **Настройки** (спека §6, форма как в `Settings.swift`): «Фоновое обучение» (вкл/выкл), «Авто-ревью» (вкл/выкл; подпись: без него плейбуки и правки ждут вас во вкладке «Ревью»), «Интервал описания сессии» (степпер 1–120 мин), «Сессия закончена после простоя» (5–1440 мин), «Фоновых агентов одновременно» (1–6); каждое изменение — `patchLearningSettings`; «Сессии без обучения» — список названий с «Включить обратно»; кнопка «Разобрать прошлые сессии…» → `BackfillSheet` (кандидаты с датами и размером, чекбоксы, «Выбрать все», «Разобрать» → `backfill(ids:)`, итог: создано / пропущено с причиной). Путь `learning.json` и папки кейсов — строкой с «Показать в Finder».
- **Сессия** (спека §5): в шапке панели агентов сессии — чип плейбука, если `learning.playbookOf(session:)` есть (название; клик — окно «Фон» на плейбуке; подсказка: версия и «загружен Claude в этой сессии»); меню «⋯» сессии (существующее меню панели или новое — по месту): «Учиться на этой сессии» (галочка; `disabledSessions`), «Собрать кейс сейчас» (`runLearning(session:)`), «Пересобрать кейс», «Остановить сборщика», «Удалить кейс сессии…» (подтверждение с `caseImpact`), «Открыть кейс» (окно «Фон»).

- [ ] **Step 1:** реализовать; `swift test`, `swift build` — PASS; снимки `docs/design/screens/background-{journal,settings}-light.png` и шапки сессии с чипом.
- [ ] **Step 2:** `app/README.md` — раздел «Окно «Фон»» (вход, разделы, ссылки `nessy-orch://background/…`, отладочный флаг); корневой `README.md` — строка.
- [ ] **Step 3:** commit «Приложение: журнал, настройки обучения, разбор прошлых, плейбук в сессии».

---

## Порядок волн для исполнителей

1. Задачи 1 (сервер) и 2 (NessyKit) — параллельно (разные языки и каталоги; NessyKit пишет модели по контракту и таблице маршрутов задачи 1).
2. Задача 3 (одна): каркас окна и общие компоненты.
3. Задачи 4, 5, 6 — параллельно (каждая — свои файлы в `Background/`; задача 6 дополнительно правит шапку панели сессии). Общие компоненты из `LearningComponents.swift` не меняют — нужное добавляют в свой файл.
4. Итоговое ревью, сборка `.app`, снимки всех разделов.

Сборка параллельно: каждый исполнитель Swift — `swift build --scratch-path /tmp/nessy-app-<задача>` и `swift test --scratch-path …`, чтобы не делить `.build`.
