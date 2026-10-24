# Фоновое обучение, этап 1: ядро сервера — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сервер сам ведёт описание каждой сессии через фонового агента nessy и превращает законченную сессию в кейс на диске, переживая рестарт и ошибки.

**Architecture:** новый модуль `learning`. Чистые функции (настройки, разбор транскрипта, порция событий, промпт и ответ сборщика, решение «что запускать») лежат в `src/domain/`. Хранение кейсов, очереди и настроек — `src/infrastructure/persistence/learning-store.ts`. `LearningService` в `src/application/learning/` склеивает события сессии (лента + транскрипт Claude Code) в `raw/events.jsonl` со своей нумерацией `n`, ставит задания в очередь на диске и исполняет их агентами nessy в служебной сессии `background`. Наружу: маршруты `/learning/*`, события SSE `learning_*`, CLI `learn` и `case`.

**Tech Stack:** TypeScript (Node ≥ 20, без рантайм-зависимостей), `node:test`, фейковый nessy (`test/support/fake-nessy.ts`, сценарии `fake-scenarios.json`).

**Spec:** `docs/superpowers/specs/2026-10-18-background-learning-design.md` (разделы 3.1, 3.2, 3.9, 4, 6; этап 2 — 3.3–3.8; этап 3 — 5).

## Global Constraints

- Стиль: табы, без точек с запятой, одинарные кавычки, комментарии по-русски; `any` и `@ts-ignore` запрещены.
- Типы только в `types.ts`, `*.types.ts`, `ports.ts`; контракт с клиентами — `shared/types/`.
- Слои `domain → application → infrastructure → interfaces`; домен без `node:fs`.
- Промпты и формат описания сессии — **на английском**; интерфейс CLI, ошибки, комментарии — на русском.
- Claude в фоне не запускается: всю смысловую работу делают агенты nessy (`orch.spawn`).
- Настройки по умолчанию: обучение вкл, авто-ревью вкл, интервал 10 мин, простой 30 мин, фоновых агентов 2. Файл `~/.nessy-orch/learning.json`, правка подхватывается без перезапуска.
- Сборщик: раз в `intervalMin` **или** после 15 новых событий, пауза между запусками ≥ 60 с; порция ≤ ~50 тыс. токенов (150 000 знаков).
- Внутренности агентов (инструменты и их вывод) и события фоновых агентов в порцию не попадают.
- Курсор описания двигается только после успешной записи `summary.md`.
- Ошибка задания: 2 повтора с паузой, затем статус `error`; данные и курсор не тронуты.
- Секреты не вычищаются (решение пользователя).
- Проверки: `npm run check` зелёный после каждой задачи.

## Review Focus

1. **Рестарт посреди задания** (сервер убит, пока сборщик работает): задание снова `queued` с пометкой «прервано», описание дописывается с прежнего курсора, дубля кейса нет — тест в задаче 7.
2. **Транскрипт дописан наполовину** (последняя строка без `\n`, файл удалён или усечён Claude Code): читаются только целые строки, смещение не уезжает за конец, усечение файла начинает чтение с 0 без падения — тест в задаче 4.
3. **Ответ агента без блока `<summary>`** (агент ответил по формату вводной, но забыл теги, или ошибся): задание считается неудачным, `summary.md` и курсор не меняются — тест в задаче 3 и задаче 7.
4. **Цепочка `/clear`**: новая сессия-преемник пишет в тот же кейс, а не заводит новый — тест в задаче 6.
5. **Пользователь выключил обучение посреди работы**: новые задания не ставятся, идущее доходит до конца, данные не удаляются; выключение для одной сессии не трогает другие — тест в задаче 7.

---

### Task 1: Контракт и настройки

**Files:**
- Create: `shared/types/learning.ts`; Modify: `shared/types/index.ts` (реэкспорт), `shared/types/events.ts` (новые `t`)
- Create: `src/domain/learning-settings.ts`
- Test: `test/unit/domain/learning-settings.test.ts`

**Interfaces:**
- Produces (`shared/types/learning.ts`):
  ```ts
  export interface LearningSettings { enabled: boolean; autoReview: boolean; intervalMin: number; idleMin: number; maxAgents: number; disabledSessions: string[] }
  export type CaseStatus = 'collecting' | 'closing' | 'ready' | 'error'
  export interface CaseGoal { title: string; type: string }
  export interface CaseView { id: string; title: string | null; sessions: string[]; status: CaseStatus; goals: CaseGoal[]; events: number; coveredUntil: number; createdAt: string; updatedAt: string; closedAt: string | null; playbook: string | null; source: 'live' | 'backfill' }
  export type JobKind = 'collect' | 'close'
  export type JobStatus = 'queued' | 'running' | 'done' | 'error'
  export interface JobView { id: string; kind: JobKind; caseId: string; status: JobStatus; attempts: number; agentId: string | null; error: string | null; note: string | null; range: [number, number] | null; createdAt: string; startedAt: string | null; finishedAt: string | null }
  export interface LearningView { settings: LearningSettings; jobs: JobView[]; cases: CaseView[] }
  export interface BackfillCandidate { kind: 'session' | 'transcript'; id: string; title: string; date: string; size: number }
  ```
- Produces (`StreamEvent`): `{ t: 'learning_job'; rev; job: JobView }`, `{ t: 'learning_case'; rev; case: CaseView }`, `{ t: 'learning_case_removed'; rev; id: string }`, `{ t: 'learning_settings'; rev; settings: LearningSettings }`.
- Produces (`src/domain/learning-settings.ts`): `DEFAULT_LEARNING: LearningSettings`, `parseLearningSettings(raw: unknown): LearningSettings`, `patchLearningSettings(prev: LearningSettings, patch: unknown): LearningSettings` (400 `bad_request` на неверный тип), константы `EVENTS_TRIGGER = 15`, `COOLDOWN_MS = 60_000`, `PORTION_CHARS = 150_000`.

- [ ] **Step 1: Тесты**
  - `parseLearningSettings(undefined)` → `DEFAULT_LEARNING` (`enabled: true, autoReview: true, intervalMin: 10, idleMin: 30, maxAgents: 2, disabledSessions: []`).
  - Битые поля заменяются умолчаниями поштучно: `{intervalMin: 'x', idleMin: 5}` → `intervalMin 10, idleMin 5`.
  - Ограничения: `intervalMin` 1…120, `idleMin` 5…1440, `maxAgents` 1…6 (за границей — ближайшая граница); `disabledSessions` — только строки, без дублей.
  - `patchLearningSettings(DEFAULT_LEARNING, {enabled: 'yes'})` бросает `AppError` 400.
- [ ] **Step 2:** `npm test` — тесты падают (нет модуля).
- [ ] **Step 3:** реализовать; неизвестные `t` приложение пропускает (`default:` в разборе событий `app/Sources/NessyKit/Models.swift`), Swift не трогаем.
- [ ] **Step 4:** `npm run check` — PASS.
- [ ] **Step 5:** commit «Обучение: контракт и настройки».

### Task 2: Транскрипт Claude Code и порция событий (домен)

**Files:**
- Create: `src/domain/learning.types.ts`, `src/domain/transcript.ts`, `src/domain/case-events.ts`
- Test: `test/unit/domain/transcript.test.ts`, `test/unit/domain/case-events.test.ts`, образцы `test/fixtures/transcripts/basic.jsonl`

**Interfaces:**
- Produces (`learning.types.ts`):
  ```ts
  export type RawKind = 'user' | 'claude' | 'task' | 'reply' | 'call'
  export interface TranscriptEntry { uuid: string; ts: number; kind: 'user' | 'claude' | 'call'; text: string }
  export interface RawEvent { n: number; ts: number; kind: RawKind; from: string; to: string | null; text: string; ref: string }
  export interface Portion { text: string; from: number; until: number }
  ```
- Produces: `parseTranscript(text: string, opts: { nessyCalls: boolean }): TranscriptEntry[]` (`transcript.ts`); `condenseReply(text: string, max?: number): string`, `renderPortion(events: readonly RawEvent[], maxChars: number): Portion` (`case-events.ts`).

Формат строки транскрипта (одна JSON-запись на строку): `{type:'user'|'assistant'|'summary'|…, uuid, timestamp (ISO), isSidechain?, isMeta?, message:{content: string | Array<{type:'text',text}|{type:'tool_use',id,name,input}|{type:'tool_result',tool_use_id,content}>}}`. Весь разбор формата — только в `transcript.ts` (риск спеки «формат не описан»).

- [ ] **Step 1: Тесты `parseTranscript`** на образце из 8 строк:
  - пользовательский текст → `kind 'user'`; блоки `<system-reminder>…</system-reminder>` вырезаны; запись только из `tool_result` — пропущена;
  - текст ассистента → `'claude'` (несколько text-блоков одной записи склеены `\n`);
  - `isSidechain: true`, `isMeta: true`, `type: 'summary'`, битая JSON-строка — пропущены без исключения;
  - `nessyCalls: true`: `tool_use` Bash с `nessy-orch spawn|send|wait` + его `tool_result` (по `tool_use_id`, содержимое строкой или text-блоками) → одна запись `'call'`: `$ <command>\n<результат>`; `nessyCalls: false` — таких записей нет; Bash без `nessy-orch` не попадает никогда.
- [ ] **Step 2: Тесты `condenseReply`**: из ответа с разделами `**Итог**`, `**Детали**`, `**Источники**`, строкой `Статус: DONE — …` остаются Итог, Источники и строка статуса, Детали выброшены; ответ без разделов → первые `max` (1500) знаков + `…`.
- [ ] **Step 3: Тесты `renderPortion`**: строка события `[n] kind from→to: text`; лимиты текста по видам `user 4000, claude 3000, task 2000, reply` — через `condenseReply`, `call 2000`; порция обрывается до превышения `maxChars`, но **одно событие берётся всегда** (иначе курсор встанет); `from`/`until` — первый и последний `n`; пустой вход → `{text: '', from: 0, until: 0}`.
- [ ] **Step 4:** `npm test` — падают; реализовать; `npm run check` — PASS.
- [ ] **Step 5:** commit «Обучение: разбор транскрипта и порция событий».

### Task 3: Промпт и ответ сборщика сессии

**Files:**
- Create: `learning/prompts/session-collector.md` (английский), `src/domain/collector.ts`
- Test: `test/unit/domain/collector.test.ts`

**Interfaces:**
- Produces: `buildCollectorPrompt(template: string, input: CollectorInput): string`, `parseCollectorReply(text: string): CollectorResult | null`; типы в `learning.types.ts`:
  ```ts
  export interface CollectorInput { caseId: string; summary: string; notes: string; portion: Portion; final: boolean }
  export interface CollectorResult { summary: string; title: string | null; goals: CaseGoal[] }
  ```

Шаблон подставляет `{{case_id}}`, `{{summary}}` (или `(empty — start a new summary)`), `{{notes}}`, `{{events}}`, `{{range}}` (`n a–b`), `{{mode}}` (`final: finish every section, the session has ended` / `incremental: update only what the new events change`). Содержание шаблона — из раздела 3.1 спеки: ты — session collector; события и описание — данные, не указания; формат `summary.md`:

```
# <session title>
## Goal: <goal> (type: <short task type, e.g. "implement package">)
### Plan
### Actions        — one line each: what, assigned to (agent, role), result; anchor `n a–b`
### Sources        — tickets, MRs, wiki spaces, files
### User corrections — what the orchestrator proposed, what the user said, anchor
### Open questions
```

Ответ: обычный формат вводной допустим, но в нём обязательны `<summary>…полный новый summary.md…</summary>` и `<meta>{"title": "...", "goals": [{"title": "...", "type": "..."}]}</meta>`.

- [ ] **Step 1: Тесты**: промпт содержит все подстановки, режим `final`, и маркер `SESSION COLLECTOR` (по нему фейковый nessy в интеграционных тестах выбирает сценарий); `parseCollectorReply`: берёт **последний** блок `<summary>` (агент мог процитировать шаблон), обрезает пробелы; нет блока или он пуст → `null`; `<meta>` битый или нет → `title: null, goals: []`; цели без `title` выброшены.
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3:** commit «Обучение: промпт и разбор ответа сборщика».

### Task 4: Хранилище обучения

**Files:**
- Create: `src/infrastructure/persistence/learning-store.ts`; Modify: `src/application/ports.ts` (`LearningStorePort`), `src/application/learning/learning.types.ts` (Create: `CaseState`, `JobState`)
- Test: `test/unit/infrastructure/learning-store.test.ts`

**Interfaces:**
- Produces (`learning.types.ts`):
  ```ts
  export interface TranscriptCursor { path: string; offset: number }
  export interface CaseState extends CaseView { feedSeq: number; transcripts: Record<string, TranscriptCursor>; nextN: number; lastEventAt: number; lastRunAt: number; nessyCalls: boolean }
  export type JobState = JobView & { final: boolean; retryAt: number | null }
  ```
- Produces (`ports.ts`):
  ```ts
  export interface LearningStorePort {
  	readonly casesDir: string
  	loadSettings(): { raw: unknown; mtimeMs: number }                 // нет файла — raw undefined, mtimeMs 0; разбирает сервис (parseLearningSettings + defaultOn)
  	settingsMtime(): number
  	saveSettings(s: LearningSettings): void
  	loadCases(): CaseState[]                                         // по cases/*/state.json; битый — пропуск с предупреждением
  	saveCase(c: CaseState): void                                     // state.json + case.md (frontmatter из CaseView)
  	removeCase(id: string): void
  	readSummary(id: string): string; writeSummary(id: string, text: string): void
  	readNotes(id: string): string
  	appendRaw(id: string, events: readonly RawEvent[]): void; readRaw(id: string, fromN: number, toN?: number): RawEvent[]
  	copyTranscript(id: string, chatId: string, cur: TranscriptCursor): { text: string; next: TranscriptCursor }
  	loadJobs(): JobState[]; saveJobs(jobs: readonly JobState[]): void
  	readPrompt(name: string): string                                 // <root>/learning/prompts/<name>.md
  }
  ```
- Раскладка: `<home>/learning.json`, `<home>/learning/jobs.json`, `<home>/cases/<id>/{state.json, case.md, summary.md, notes.md, raw/events.jsonl, raw/transcript-<chatId>.jsonl}`. Запись — `writeAtomic`/`appendJsonl` из `jsonl.ts`; ошибки диска — как `FileStore.safe` (не роняют сервер).

- [ ] **Step 1: Тесты (tmp-каталог)**:
  - нет `learning.json` → `raw: undefined, mtimeMs: 0`; `saveSettings` → файл, `settingsMtime()` растёт;
  - `saveCase` + `loadCases` — круг; `case.md` начинается с `---\nid: …\nstatus: …\nsessions: […]` ;
  - `copyTranscript`: файл `a\nb\nc` без последнего `\n` → `text 'a\nb\n'`, `next.offset 4`, байты дописаны в `raw/transcript-<chat>.jsonl`; повтор после дописи `\n` → `'c\n'`; файл стал короче `offset` → чтение с 0; файла нет → `text ''`, курсор прежний;
  - `appendRaw`/`readRaw(id, 3, 5)` возвращает события `n` 3…5;
  - `removeCase` удаляет каталог целиком; `readPrompt('session-collector')` читает файл задачи 3.
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3:** commit «Обучение: хранилище кейсов, очереди и настроек».

### Task 5: Сессии — путь транскрипта и служебная сессия

**Files:**
- Modify: `shared/types/domain.ts` (`SessionView.transcriptPath?: string | null`, `SessionView.service?: boolean`), `shared/types/api.ts` (`AttachRequest.transcriptPath?: string`), `src/interfaces/http/parsers.ts` (`parseAttachRequest`), `src/application/services/sessions.service.ts`, `src/infrastructure/persistence/file-store.ts` (`loadSessions` сохраняет поля), `src/interfaces/cli/commands/hook.commands.ts` (`runStart` передаёт `transcript_path`)
- Test: `test/unit/application/sessions.test.ts`, `test/integration/sessions.test.ts`

**Interfaces:**
- Produces: `SessionsService.ensureService(id: string, title: string, cwd: string): SessionView` (создаёт или возвращает); `SessionsService.list(opts?: { service?: boolean }): SessionView[]` — служебные **не входят** по умолчанию (значит, их нет в `graph()`, `GET /sessions`, уборке `pruneOnce`); событие `session` на шину для служебной сессии не публикуется. `SERVICE_SESSION = 'background'` в `src/domain/constants.ts`.
- `attach`: абсолютный `transcriptPath` записывается в найденную или новую сессию (не абсолютный — 400).

- [ ] **Step 1: Тесты**: `attach({chatId, transcriptPath: '/t/1.jsonl'})` → `session.transcriptPath === '/t/1.jsonl'`, переживает `load()` из `FileStore`; `transcriptPath: 'rel'` → 400; `ensureService` дважды → одна сессия; её нет в `listSessions()` и `graph().sessions`, но `getSession('background')` и `spawn({session: 'background'})` работают; интеграционный: `hook start` с `transcript_path` в stdin передаёт путь (`GET /sessions/<id>` с токеном оператора показывает его).
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3:** commit «Сессии: путь транскрипта Claude и служебная сессия».

### Task 6: LearningService — сбор событий и жизнь кейса

**Files:**
- Create: `src/application/learning/learning.service.ts`, `src/application/learning/case-ingest.ts`; Modify: `src/application/learning/learning.types.ts` (`LearningDeps`), `src/domain/learning-schedule.ts` (Create)
- Test: `test/unit/application/learning-ingest.test.ts`, `test/unit/domain/learning-schedule.test.ts`

**Interfaces:**
- Consumes: `LearningStorePort` (задача 4), `parseTranscript`/`renderPortion` (задача 2), `SessionsService.list` (задача 5).
- Produces (`learning.types.ts`):
  ```ts
  export interface LearningHost {
  	sessions(): SessionView[]                                   // все, кроме служебных
  	messagesSince(seq: number): Message[]                        // лента после seq; окно памяти — иначе с диска
  	sessionOfMessage(m: Message): string | null                  // m.session ?? сессия агента to/from
  	isBusy(sessionIds: readonly string[]): boolean               // есть работающий агент или очередь
  	runAgent(req: { name: string; title: string; prompt: string }): Promise<{ agentId: string; text: string; ok: boolean; error?: string }>
  }
  export interface LearningDeps { store: LearningStorePort; host: LearningHost; hub: Hub; clock: Clock; ids: IdGenerator; defaultOn: boolean; tickMs: number; claudeProjectsDir: string }
  ```
- Produces (`learning-schedule.ts`): `decide(c: { status: CaseStatus; pending: number; lastRunAt: number; lastEventAt: number; busy: boolean; hasJob: boolean }, now: number, s: LearningSettings): 'none' | 'collect' | 'close'`.
- Produces (`case-ingest.ts`): `chainOf(sessions: readonly SessionView[], id: string): string[]` (корень → последняя по `successor`), `caseIdOf(rootSessionId: string): string` (`'c-' + root`), `ingest(c: CaseState, input: { messages: Message[]; transcripts: Array<{ chatId: string; text: string; next: TranscriptCursor }> }): { events: RawEvent[]; state: CaseState }` — события ленты и транскрипта одной порции сортируются по `ts` и нумеруются подряд с `c.nextN`.
- Produces (`LearningService`, только сбор в этой задаче): `tick(): void` (синхронно собирает события всех цепочек, затем решения), `view(): LearningView`, `getCase(id): CaseState`, `onAttach(sessionId)`.

Решения `decide`:
- `hasJob` → `none`; `status 'ready'` и `pending > 0` → кейс снова `collecting` (возврат в сессию) и `collect`;
- `collecting`: простой `now − lastEventAt ≥ idleMin` и не `busy` → `close`; `pending ≥ EVENTS_TRIGGER` или (`pending > 0` и `now − lastRunAt ≥ intervalMin`) — при `now − lastRunAt ≥ COOLDOWN_MS` → `collect`; иначе `none`.

Правила сбора:
- Кейс заводится при первом событии цепочки (пустая сессия кейса не даёт). В цепочку и кейс входит преемник `/clear` (`successor`), id кейса — от корня.
- Сообщения ленты служебной сессии и её агентов не берутся; от ленты берутся `kind` `msg` от оператора (`task`) и `reply` агентов (`reply`); полный текст пишется в `raw/`, сжатие — только в порции.
- `lastEventAt` — максимум `ts` новых событий и `updatedAt` сессий цепочки.
- Обучение выключено (`enabled: false` или сессия в `disabledSessions`) — события не собираются и решения не принимаются.

- [ ] **Step 1: Тесты `decide`** — таблица из 8 строк по правилам выше (в т.ч. `busy` блокирует `close`, пауза 60 с блокирует `collect`, 15 событий запускают раньше интервала).
- [ ] **Step 2: Тесты сбора** (фейковый `LearningHost`, `MemoryStore`-аналог `LearningStorePort` в `test/support/memory-learning-store.ts`):
  - два сообщения сессии `s1` + 2 записи транскрипта → кейс `c-s1`, 4 события `n` 1…4 по времени, `feedSeq` = последний seq, курсор транскрипта сдвинут;
  - повторный `tick` без новых данных событий не добавляет;
  - `s1.successor = s2`, сообщение в `s2` → событие в `c-s1`, `sessions: ['s1','s2']`;
  - сообщения агента служебной сессии в кейс не попадают;
  - `disabledSessions: ['s1']` → кейса нет.
- [ ] **Step 3:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 4:** commit «Обучение: сбор событий сессии в кейс».

### Task 7: Очередь заданий и сборщик

**Files:**
- Modify: `src/application/learning/learning.service.ts`; Create: `src/application/learning/job-queue.ts`
- Test: `test/unit/application/learning-jobs.test.ts`

**Interfaces:**
- Consumes: `buildCollectorPrompt`, `parseCollectorReply` (задача 3), `decide` (задача 6), `LearningHost.runAgent`.
- Produces (`JobQueue`): `load(jobs: JobState[]): void` (`running` → `queued`, `note: 'прервано перезапуском'`), `enqueue(kind: JobKind, caseId: string, final: boolean): JobState` (у кейса уже есть `queued` — тот получает `final ||= final`, новое не создаётся; есть `running` — новое `queued` встаёт за ним), `next(now: number): JobState | null` (по порядку, с учётом `retryAt`), `list(): JobState[]` (хранятся 200 последних завершённых).
- Produces (`LearningService`): `runNow(sessionOrCaseId: string): JobView` (ручной «Собрать кейс сейчас» — задание `close`), `onSessionClosed(sessionId: string): void` (закрыли вкладку — `close` сразу), `retry(jobId: string): JobView`, `isProtected(sessionId: string): boolean` (кейс цепочки не `ready`), `start(): void`, `stop(): Promise<void>`.

Исполнение задания (не больше `maxAgents` одновременно; насос — при постановке, завершении и `tick`):
1. Порция: `readRaw(caseId, coveredUntil + 1)` → `renderPortion(…, PORTION_CHARS)`. Пусто и `final` → кейс `ready`, `closedAt`, агент не нужен.
2. `runAgent({ name: 'collector-<caseId>', title: 'Описание сессии <title|caseId>', prompt })`; задание хранит `agentId`, `range`.
3. Ответ разобран → `writeSummary`, затем `coveredUntil = until`, `title`/`goals` из `meta`, `lastRunAt = now`, `saveCase`. Порция не дошла до конца событий → следующее задание того же вида ставится сразу; `final` и всё покрыто → `ready`.
4. Ошибка (`ok: false`, исключение, `null` от разбора): `attempts++`; `attempts ≤ 2` → `queued`, `retryAt = now + 30_000 · attempts`; иначе `error` с текстом. Кейс при `error` задания `close` — `status 'error'` (тогда `isProtected` = true, сессию не удалят).
5. Каждое изменение задания и кейса — `saveJobs`/`saveCase` и событие шины `learning_job` / `learning_case`.
6. Выключили обучение — новые задания не ставятся (`tick`, `onSessionClosed` молчат), `running` доходит до конца; `runNow` и `retry` работают и при выключенном (явная команда пользователя).

- [ ] **Step 1: Тесты** (фейковый `runAgent` по сценарию; часы — объект `{ t }`):
  - 15 событий → одно задание `collect`, `summary.md` записан, `coveredUntil` = 15, событие `learning_case` опубликовано;
  - ответ без `<summary>` → `summary.md` и `coveredUntil` не тронуты; два повтора через 30 и 60 с, третий провал → `error`, `retry(id)` ставит заново;
  - `onSessionClosed('s1')` → `close`; после ответа кейс `ready`, `closedAt` задан; новое событие → снова `collecting`, следующее `close` **дописывает** (в промпт ушло прежнее описание);
  - порция больше `PORTION_CHARS` → два задания подряд, курсор доходит до конца;
  - `maxAgents: 2`, три кейса → третий ждёт `queued`, пока не освободится место;
  - рестарт: `JobQueue.load` с `running` → `queued` + `note`; исполнение начинается с прежнего `coveredUntil`;
  - `enabled: false` посреди `running` → задание доходит до конца, новых нет; `disabledSessions: ['s2']` не мешает `s1`;
  - `isProtected('s1')` — true, пока кейс не `ready`.
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3:** commit «Обучение: очередь заданий и сборщик сессии».

### Task 8: Сборка в приложение

**Files:**
- Modify: `src/app.ts`, `src/application/orchestrator.ts`, `src/application/settings.types.ts`, `src/infrastructure/config/load-config.ts`, `test/support/harness.ts`
- Test: `test/unit/application/session-prune.test.ts` (дополнить), `test/integration/learning.test.ts` (Create)

**Interfaces:**
- Produces (`OrchSettings`): `learningDefaultOn?: boolean` (по умолчанию true; стенд тестов — false, чтобы прежние тесты не порождали фоновых агентов), `learningTickMs?: number` (по умолчанию 30 000; 0 — без таймера, тесты вызывают `tick()` сами), `claudeProjectsDir?: string` (по умолчанию `~/.claude/projects`). Переменные окружения в `load-config.ts`: `ORCH_LEARNING_DEFAULT`, `ORCH_LEARNING_TICK_MS`, `CLAUDE_PROJECTS_DIR`.
- Produces (`Orchestrator`): `readonly learning: LearningService` (создаётся, если в deps есть `learningStore`; иначе заглушка «обучение недоступно» с 503 на маршрутах); `setSessionGuard` не нужен — `pruneOnce` спрашивает `this.learning.isProtected(id)`; `sessionClosed` вызывает `learning.onSessionClosed`; `attachSession` — `learning.onAttach`; `start()` — `learning.start()`; `shutdown()` — `await learning.stop()` до остановки пространств.
- `LearningHost.runAgent` = `ensureService(SERVICE_SESSION, 'Фон', store.casesDir)` + `spawn({ session: SERVICE_SESSION, name, title, prompt, wait: true, waitTimeoutSec: 1800 })`; `ok` = есть `reply` без `failed`; агента после ответа архивировать (`archiveAgent`), чтобы он не висел в рабочем списке.

- [ ] **Step 1: Тесты**: уборка не удаляет сессию с незакрытым кейсом и удаляет после `ready` (unit, фейковый `learning`); интеграционный (стенд с `learningDefaultOn: true`, `fake-scenarios.json` в `home`: ключ `SESSION COLLECTOR` → `[{text: '<summary>\n# T\n## Goal: g (type: t)\n</summary>\n<meta>{"title":"T","goals":[{"title":"g","type":"t"}]}</meta>\nСтатус: DONE'}]`): сессия, `spawn` агента с ответом, `POST /sessions/:id/closed` → дождаться `learning_case` со `status: 'ready'` в `/stream`; `cases/c-<id>/summary.md` содержит `# T`; фоновый агент в сессии `background`, архивирован; `GET /sessions` служебной сессии не показывает.
- [ ] **Step 2: Рестарт** (интеграционный): сценарий `#slow` для сборщика, закрыть стенд с `keepFiles` посреди работы, поднять на том же `base` → задание снова выполняется, кейс один, `jobs.json` без `running`.
- [ ] **Step 3:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 4:** commit «Обучение: подключено к оркестратору».

### Task 9: API, CLI и разбор прошлых сессий

**Files:**
- Create: `src/interfaces/http/routes/learning.routes.ts`, `src/interfaces/cli/commands/learning.commands.ts`, `src/infrastructure/persistence/transcript-scan.ts`; Modify: `src/interfaces/http/server.ts` (регистрация), `src/interfaces/cli/main.ts`, `src/interfaces/cli/help.ts`, `src/interfaces/cli/format.ts` (таблицы), `src/interfaces/http/parsers.ts`
- Test: `test/integration/learning.test.ts` (дополнить), `test/unit/infrastructure/transcript-scan.test.ts`

**Interfaces:**
- Маршруты (не-GET — только оператор, как остальные):

  | Метод и путь | Что делает |
  |---|---|
  | `GET /learning` | `LearningView` |
  | `PATCH /learning/settings` | `patchLearningSettings`, сохранить, `learning_settings` |
  | `POST /learning/run` `{session?}` | `runNow` по сессии (без — все открытые кейсы) |
  | `POST /learning/jobs/:id/retry` | `retry` |
  | `GET /learning/cases/:id` | `CaseView` + `summary`, `notes` |
  | `DELETE /learning/cases/:id` | удалить кейс и `raw/` (идущее задание кейса — 409 `case_busy`); `learning_case_removed` |
  | `POST /learning/cases/:id/rebuild` | сбросить `coveredUntil` и `summary.md`, задание `close` |
  | `GET /learning/backfill` | `BackfillCandidate[]` |
  | `POST /learning/backfill` `{ids: string[]}` | завести кейсы `source: 'backfill'` и задания `close` по очереди |
- CLI: `nessy-orch learn [status] | on | off | run [--session S] | backfill [--all | <id…>]`, `nessy-orch case ls | show <id> | rm <id> | rebuild <id>`; `on`/`off` с `--session` правят `disabledSessions`. Без аргументов `learn backfill` печатает кандидатов (id, дата, размер).
- `transcript-scan.ts`: `scanTranscripts(dir: string, knownChatIds: ReadonlySet<string>): BackfillCandidate[]` — файлы `*/*.jsonl` в `~/.claude/projects`, где встречается `nessy-orch spawn` или `nessy-orch send` (чтение потоком до первого совпадения), кроме чатов, у которых уже есть сессия; `id` — имя файла без `.jsonl`, `title` — первая пользовательская строка (до 80 знаков), `date` — mtime.
- Кандидаты-сессии: сессии из `sessions()` без кейса, у которых в ленте (с диска) есть хотя бы одно сообщение. Для `transcript` кейс получает `nessyCalls: true` и курсор транскрипта на этот файл; для `session` — `feedSeq: 0` и `transcriptPath` сессии, если есть.

- [ ] **Step 1: Тесты**: `scanTranscripts` на tmp-каталоге (3 файла: с `nessy-orch spawn`, без, известный чат) → один кандидат; интеграционные: `PATCH /learning/settings {enabled:false}` → `learning.json` записан, правка файла руками подхватывается следующим `tick` без рестарта; `DELETE /learning/cases/:id` удаляет каталог; бэкфилл транскрипта из `CLAUDE_PROJECTS_DIR` создаёт кейс `ready` (сценарий фейкового сборщика); CLI `case ls` печатает таблицу, `learn off --session S` добавляет S в `disabledSessions`; маршруты без токена оператора на запись — 403.
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3: Документация**: README (раздел «Фоновое обучение»: что делает, файлы, CLI, `learning.json`), `docs/` API-раздел с маршрутами и событиями `learning_*`, строка в `CLAUDE.md` про модуль `learning`.
- [ ] **Step 4:** commit «Обучение: API, CLI и разбор прошлых сессий».

---

## Что остаётся этапам 2–3

- Этап 2: сопоставитель, сборщик плейбука, судья, авто-ревью (ступени 1–6), счётчики, публикация в `~/.claude/skills/nessy-playbooks/`, подсказка через `UserPromptSubmit`, чат и заметки кейса (`notes.md` в этапе 1 только читается сборщиком).
- Этап 3: вкладка «Фон» в приложении; до неё служебная сессия скрыта сервером, а её агенты видны в CLI (`ls --all`).
- Проверка разбора прошлых сессий на рабочей машине (на машине разработки их нет, спека §8).
