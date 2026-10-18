# Фоновое обучение, этап 2: плейбуки — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** из готовых кейсов сами получаются плейбуки: сопоставитель находит повторяющиеся задачи, сборщик пишет плейбук по полным сессиям, авто-ревью из шести ступеней его проверяет, судья и счётчики ведут правила, активные плейбуки публикуются в Claude Code и подсказываются на живой задаче.

**Architecture:** этап 1 (`src/application/learning/`) даёт кейсы, очередь заданий и запуск агентов nessy. Этап 2 обобщает очередь (задание — над любым объектом: кейсом, плейбуком, группой), выносит исполнение заданий в обработчики (`*.handler.ts`, один файл на вид задания) и добавляет `PlaybookService` (состояние плейбуков, версии, правила, журнал). Чистая логика (поиск, разметка плейбука, линтер, счётчики, разбор ответов агентов) — в `src/domain/`; файлы, git и публикация — в `src/infrastructure/persistence/`. Смысловую работу делают агенты nessy по промптам из `learning/prompts/` (английский; сторонние промпты скопированы целиком и правлены минимально).

**Tech Stack:** TypeScript (Node ≥ 20, без рантайм-зависимостей), `git` через `child_process.execFile` (есть на macOS), `node:test`, фейковый nessy со сценариями `fake-scenarios.json`.

**Spec:** `docs/superpowers/specs/2026-10-18-background-learning-design.md` §3.3–3.8, §4, §7, §8. Этап 1: `docs/superpowers/plans/2026-10-18-background-learning-phase1.md`.

## Global Constraints

- Всё из Global Constraints этапа 1 (стиль, слои, типы, английские промпты, Claude в фоне не запускается, `npm run check` зелёный).
- Плейбук — скилл на английском: `SKILL.md` (`description` начинается с `Use when`), `stages/NN-<slug>.md`, `rules.md`, `notes.md`, `CHANGELOG.md`; история — git в папке плейбука.
- Группа для сборки плейбука — **≥ 3 кейса** с одной задачей. Правило — при **двух кейсах «за» и ни одного «против»**; одна поправка — кандидат.
- Счётчики: новое правило ▲2 ▼0; применено и не поправлено ▲+1; пользователь поправил вопреки правилу ▼+1; 8 недель без применения ▲−1; ▲−▼ ≤ 0 — правило в архив. Вердикты выдаёт **судья** — отдельный агент после закрытия кейса; счётчики меняет код.
- Повторно открытый кейс пересчитывается один раз — при окончательном закрытии (вердикты кейса заменяются, не складываются).
- Авто-ревью: проходит, если на ступенях 1–4 нет критичных замечаний, а на 5 плейбук не хуже плана без него. Ревьюер — свежий агент, видит результат и доказательства, а не рассуждения сборщика. Пороги мягкие.
- Ступень 5 только планирует: ничего не исполняет и во внешние системы не пишет; ≥ 3 прогона, слепой судья.
- Ступень 6 — агент nessy как приближение к выбору Claude.
- Пробный режим: среднее число поправок на кейс этого типа до плейбука против первых трёх кейсов с ним; больше — плейбук выключается с записью в журнал, не больше — становится активным.
- Каждое автоматическое решение пишется в журнал с отчётом и откатывается одной командой.
- Отклонённые правки помнятся и больше не предлагаются. Заметки пользователя (`notes.md`) автоматически не переписываются.
- Сторонние промпты: источник и лицензия — в `THIRD_PARTY_NOTICES.md` (skill-creator Apache-2.0, superpowers MIT, spec-kit MIT).
- Решение исполнителя этапа: скрипты skill-creator (`quick_validate.py`, `run_loop.py`) не запускаются — их проверки перенесены в TypeScript (линтер ступени 1) и в промпт ступени 6; Python не нужен. Ловля поправок регулярками (claude-reflect) и почти-дубли claude-mem заменены своим кодом (подсчёт поправок по разделу описания, сходство по шинглам).

## Review Focus

1. **Шторм агентов**: сопоставитель после каждого кейса бэкфилла (пачка из 30) и ревью, которое бесконечно отправляет плейбук на доработку. Ожидание: сопоставитель после пачки — один раз; доработка после провала ревью — не больше одной попытки, затем `review` у человека — тест в задачах 8 и 10.
2. **Агент вернул мусор** (нет JSON, JSON не той формы, ссылки на несуществующие кейсы и якоря): задание падает с понятной ошибкой и повторами этапа 1, плейбук не меняется, выдуманные ссылки отбрасываются линтером — тесты в задачах 3 и 4.
3. **Откат** публикации, версии или включения правила восстанавливает прежние файлы плейбука и папку `nessy-playbooks` — тест в задаче 5.
4. **Повторное закрытие кейса** не удваивает счётчики — тест в задаче 2 и 9.
5. **Подсказка UserPromptSubmit** не задерживает Claude (сервер недоступен, медленный поиск) и не повторяется на каждом сообщении — тест в задаче 11.

---

### Task 1: Контракт и типы этапа 2

**Files:**
- Modify: `shared/types/learning.ts`, `shared/types/events.ts`
- Create: `src/domain/playbook.types.ts`
- Modify: `src/application/learning/learning.types.ts`, `src/application/ports.ts`
- Test: компиляция; `test/unit/domain/learning-settings.test.ts` без изменений зелёный

**Interfaces:**
- Produces (`shared/types/learning.ts`):
  ```ts
  export type JobKind = 'collect' | 'close' | 'match' | 'build' | 'review' | 'judge' | 'improve' | 'edit'
  // JobView: поле caseId остаётся (для заданий кейса), добавляется subject: string — id объекта задания
  //   (кейс, плейбук `p-…`, группа `g-…`, 'all' у сопоставителя); у collect/close subject === caseId
  export type PlaybookStatus = 'draft' | 'review' | 'trial' | 'active' | 'disabled' | 'archived'
  export type RuleStatus = 'candidate' | 'active' | 'archived'
  export interface Evidence { caseId: string; anchor: string }            // anchor: 'n 12–15'
  export interface RuleView { id: string; text: string; stage: number | null; status: RuleStatus; up: number; down: number; evidence: Evidence[]; against: Evidence[]; lastAppliedAt: string | null; createdAt: string }
  export interface PlaybookParam { name: string; description: string; source: string }
  export interface PlaybookStage { n: number; slug: string; title: string; role: string | null; where: string; produce: string; done: string; gate: boolean; template: string }
  export interface PlaybookView { id: string; name: string; title: string; description: string; taskType: string; status: PlaybookStatus; version: number; cases: string[]; heldOut: string | null; params: PlaybookParam[]; sources: string[]; files: string[]; behavior: string[]; stages: PlaybookStage[]; rules: RuleView[]; trial: { before: number; cases: string[]; corrections: number[] } | null; createdAt: string; updatedAt: string }
  export interface PlaybookDetail extends PlaybookView { notes: string; changelog: string; versions: Array<{ version: number; ts: string; message: string }>; reviews: ReviewReport[] }
  export type StageVerdict = 'pass' | 'fail' | 'skip'
  export interface StageReport { stage: 1 | 2 | 3 | 4 | 5 | 6; verdict: StageVerdict; critical: string[]; notes: string[]; agentIds: string[] }
  export interface ReviewReport { playbookId: string; version: number; ts: string; passed: boolean; stages: StageReport[] }
  export interface JournalEntry { id: string; ts: string; kind: 'playbook_created' | 'review_passed' | 'review_failed' | 'published' | 'trial_passed' | 'trial_failed' | 'rule_activated' | 'rule_archived' | 'version' | 'reverted' | 'edit'; subject: string; summary: string; report: string | null; revertible: boolean; revertedBy: string | null }
  export interface ChatMessage { id: string; ts: string; from: 'user' | 'agent'; text: string; changes: string[] }
  // LearningView: + playbooks: PlaybookView[]; + journal: JournalEntry[] (последние 200)
  // LearningSettings без изменений (autoReview уже есть)
  ```
- Produces (`StreamEvent`): `learning_playbook {playbook}`, `learning_playbook_removed {id}`, `learning_journal {entry}`, `learning_chat {subject, message}`.
- Produces (`src/domain/playbook.types.ts`): `MatchGroup { task: string; taskType: string; playbookId: string | null; cases: Evidence[] }`, `BuildDraft` (всё содержимое `PlaybookView` от `title` до `rules`, правила как `{ text; stage; evidence: Evidence[] }`), `RuleVerdict { ruleId: string; verdict: 'applied' | 'violated_by_user_correction' | 'not_applicable'; anchor: string | null }`, `Improvement { cause: 'gap' | 'error' | 'non_compliance' | 'one_off'; edits: Array<{ file: string; before: string; after: string; anchor: string }>; candidates: Array<{ text: string; stage: number | null; evidence: Evidence[] }> }`, `LintIssue { level: 'critical' | 'note'; where: string; text: string }`, `PlaybookFiles = Record<string, string>` (относительный путь → текст).
- Produces (`learning.types.ts`): `PlaybookState extends PlaybookView { verdicts: Record<string, RuleVerdict[]>; rejectedEdits: string[]; reviewAttempts: number }`; `JobState` получает `subject` и `payload: Record<string, unknown> | null`.
- Produces (`ports.ts`): `PlaybookStorePort` — сигнатуры задачи 5 (объявить здесь, реализует задача 5):
  ```ts
  export interface PlaybookStorePort {
  	readonly playbooksDir: string
  	loadPlaybooks(): PlaybookState[]
  	savePlaybook(p: PlaybookState, files: PlaybookFiles, message: string): number   // пишет playbook.json и файлы, git commit; возвращает номер версии
  	readFiles(id: string): PlaybookFiles
  	versions(id: string): Array<{ version: number; ts: string; message: string }>
  	restoreVersion(id: string, version: number): { state: PlaybookState; files: PlaybookFiles } | null
  	removePlaybook(id: string): void
  	readNotes(id: string): string; writeNotes(id: string, text: string): void
  	saveReview(r: ReviewReport): void; loadReviews(id: string): ReviewReport[]
  	appendJournal(e: JournalEntry): void; loadJournal(limit: number): JournalEntry[]; updateJournal(e: JournalEntry): void
  	appendChat(subject: string, m: ChatMessage): void; loadChat(subject: string, limit: number): ChatMessage[]
  	publish(active: ReadonlyArray<{ id: string; files: PlaybookFiles }>, version: string): void   // перезаписывает плагин nessy-playbooks целиком
  }
  ```
  `LearningStorePort` получает `writeNotes(id: string, text: string): void` и `jobs.json` хранит новые поля (миграция: нет `subject` → `subject = caseId`, нет `payload` → `null`).

- [ ] **Step 1:** внести типы; `JobQueue` (этап 1) переходит на `subject` (дедупликация и «одно задание на объект» — по `subject`), `caseId` для заданий не над кейсом — `''`. Существующие тесты очереди и сервиса правятся только по имени поля.
- [ ] **Step 2:** `npm run check` — PASS.
- [ ] **Step 3:** commit «Обучение, этап 2: контракт плейбуков».

### Task 2: Домен — плейбук: разметка, линтер, счётчики, пробный режим

**Files:**
- Create: `src/domain/playbook-render.ts`, `src/domain/playbook-lint.ts`, `src/domain/rule-counters.ts`
- Test: `test/unit/domain/playbook-render.test.ts`, `test/unit/domain/playbook-lint.test.ts`, `test/unit/domain/rule-counters.test.ts`

**Interfaces:**
- Produces: `renderPlaybook(p: PlaybookView, notes: string, changelog: string): PlaybookFiles` — файлы `SKILL.md`, `stages/NN-<slug>.md`, `rules.md`, `notes.md`, `CHANGELOG.md`; `skillName(id: string): string` (kebab, ≤ 64); `addChangelog(prev: string, version: number, date: string, lines: string[]): string`.
- Produces: `lintPlaybook(p: PlaybookView, files: PlaybookFiles, knownCases: ReadonlySet<string>): LintIssue[]`.
- Produces: `ruleCounters(r: { evidence: Evidence[]; createdAt: string }, verdicts: readonly RuleVerdict[], now: number): { up: number; down: number; lastAppliedAt: string | null; status: RuleStatus }`, `applyVerdicts(p: PlaybookState, caseId: string, verdicts: RuleVerdict[], now: number): PlaybookState`, `promoteCandidates(p: PlaybookState): PlaybookState`, `trialDecision(trial: NonNullable<PlaybookView['trial']>): 'pending' | 'pass' | 'fail'`, `countCorrections(summary: string): number`.

Разметка `SKILL.md` (frontmatter `name: <skillName>`, `description: <description>`), разделы по спеке §3.4: Parameters (имя, что это, откуда взять), Sources, Key files, Steps (одна строка на этап со ссылкой `stages/NN-slug.md`), Behavior, Rules (ссылка на `rules.md`), Notes (ссылка на `notes.md`). Этап: что сделать, роль, где и что искать, что вернуть, «Done when», «Show the user before continuing» при `gate`, шаблон поручения в блоке кода. `rules.md`: только `active`; строка: текст, этап, `▲up ▼down`, ссылки `case-id n a–b`.

Линтер (перенос правил `quick_validate.py` + свои): critical — нет frontmatter/`name`/`description`; `name` не kebab или > 64; `description` > 1024 знаков, содержит `<` или `>`, не начинается с `Use when`; `SKILL.md` > 500 строк; у активного правила < 2 доказательств из разных существующих кейсов; доказательство ссылается на неизвестный кейс или якорь не вида `n a–b`; нет ни одного этапа. note — этап без `done`; параметр без `source`.

Счётчики: `up = 2 + applied − floor((now − last)/8 недель)`, где `last` — последнее `applied` или `createdAt`; `down = violated`; `up − down ≤ 0` → `archived`. Кандидат становится `active`, когда в `evidence` ≥ 2 разных кейса, а в `against` нет ни одного. `applyVerdicts` **заменяет** вердикты кейса `caseId`. Пробный режим: `cases.length < 3` → `pending`; среднее `corrections` > `before` → `fail`, иначе `pass`. `countCorrections` — число пунктов раздела `### User corrections` всех целей, кроме `- none`.

- [ ] **Step 1: Тесты**: разметка плейбука из 2 этапов (один `gate`) даёт 6 файлов с ожидаемыми заголовками и путями; `skillName('P Aff Package!')` → `p-aff-package`; линтер на эталонном плейбуке — 0 critical, на каждом нарушении из списка — ровно одна critical с `where`; счётчики: 2 `applied` → `up 4`; 1 `violated` → `down 1`; 17 недель без применения → `up 0`, `archived`; повторный `applyVerdicts` того же кейса не удваивает; кандидат с 2 кейсами «за» → `active`, с одним «против» — остаётся кандидатом; `trialDecision` на трёх кейсах `[1,0,2]` при `before 1` → `pass`, `[3,2,2]` → `fail`; `countCorrections` на описании с двумя целями (2 и `- none`) → 2.
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3:** commit «Обучение, этап 2: разметка, линтер и счётчики плейбука».

### Task 3: Домен — поиск, якоря, использование плейбука в транскрипте

**Files:**
- Create: `src/domain/learning-search.ts`, `src/domain/anchors.ts`
- Modify: `src/domain/transcript.ts`, `src/domain/learning.types.ts` (`RawKind` + `'skill'`), `src/domain/case-events.ts` (вид `skill` в порции: `[n] skill: nessy-playbooks:<id>`)
- Test: `test/unit/domain/learning-search.test.ts`, `test/unit/domain/anchors.test.ts`, `test/unit/domain/transcript.test.ts` (дополнить)

**Interfaces:**
- Produces: `tokenize(text: string): string[]` (нижний регистр, латиница/кириллица/цифры, стоп-слова en+ru, без слов < 3 знаков), `buildIndex(docs: ReadonlyArray<{ id: string; text: string }>): SearchIndex`, `search(ix: SearchIndex, query: string, limit: number): Array<{ id: string; score: number }>` (BM25, k1 1.2, b 0.75), `similarity(a: string, b: string): number` (Жаккар по 3-словным шинглам), `caseDigest(summary: string): string` (заголовок, цели и типы, строки Actions и Sources — то, что читает сопоставитель).
- Produces: `parseAnchor(a: string): { from: number; to: number } | null` (`n 12–15`, `n 12-15`, `n 12`), `mergeRanges(rs: Array<{from; to}>, pad: number): Array<{from; to}>`.
- Produces: `parseTranscript` выдаёт записи `kind: 'skill'`, `text: '<имя скилла>'` для `tool_use` с `name: 'Skill'` (поле `input.skill` или `input.command`) — всегда, независимо от `nessyCalls`. `SearchIndex` — тип в `playbook.types.ts`.

- [ ] **Step 1: Тесты**: поиск по 5 описаниям находит кейс «implement aff package» по запросу «aff пакет реализовать» выше остальных; `similarity` одинаковых текстов 1, разных — < 0.2; `caseDigest` не содержит раздела Open questions; якоря всех трёх форм, мусор → `null`; `mergeRanges([{1,3},{5,9}], 2)` → `[{1,11}]` с отступом (нижняя граница ≥ 1); транскрипт с `Skill` → запись `skill`.
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3:** commit «Обучение, этап 2: поиск по кейсам, якоря, вызовы скиллов в транскрипте».

### Task 4: Промпты фоновых агентов и разбор их ответов

**Files:**
- Create: `learning/prompts/{matcher,case-analyst,playbook-builder,judge,improver,editor,grader,reviewer,consistency,planner,comparator,selector,description-improver}.md`, `THIRD_PARTY_NOTICES.md`, `src/domain/learning-replies.ts`
- Test: `test/unit/domain/learning-replies.test.ts`, `test/unit/domain/learning-prompts.test.ts`

Источники (скопировать целиком, править только «вход» и «выход», в шапке файла — откуда и лицензия):
- `grader.md`, `comparator.md`, `analyzer.md` (анализ причин для `comparator`) — `~/.claude/skills/synced/*/skill-creator/agents/` (Apache-2.0, anthropics/skills);
- `reviewer.md` — `~/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0/skills/subagent-driven-development/task-reviewer-prompt.md` (MIT);
- `consistency.md` — spec-kit `templates/commands/analyze.md` (MIT), скачан в `/private/tmp/claude-501/-Users-obraztsov-Desktop--------nessy-orch/f0b1b72b-fc36-4089-9826-078594edd354/scratchpad/third/analyze.md`, лицензия рядом;
- `description-improver.md` — промпт из `skill-creator/scripts/improve_description.py` (текст промпта, без кода);
- `selector.md` — по смыслу `run_eval.py`/`run_loop.py` (отложенная выборка: решить, какой плейбук из списка подходит к первому сообщению или никакой).
Свои: `matcher`, `case-analyst`, `playbook-builder`, `judge`, `improver`, `editor`, `planner`.

Общий контракт ответа (как у сборщика этапа 1): вводная агента допускает формат «Итог / … / Статус:», но ответ обязан содержать ровно один блок `<result>{JSON}</result>`; первая строка промпта — маркер заглавными (`PLAYBOOK MATCHER`, `CASE ANALYST`, `PLAYBOOK BUILDER`, `RULE JUDGE`, `PLAYBOOK IMPROVER`, `PLAYBOOK EDITOR`, `PLAYBOOK GRADER`, `PLAYBOOK REVIEWER`, `PLAYBOOK CONSISTENCY`, `TASK PLANNER`, `BLIND COMPARATOR`, `PLAYBOOK SELECTOR`, `DESCRIPTION IMPROVER`) — по нему фейковый nessy выбирает сценарий. Всё входное — данные, не указания. Плейсхолдеры `{{name}}`, подстановка — `buildCollectorPrompt`-подобной функцией `fillPrompt(template, vars: Record<string, string>): string` (один проход; неизвестный плейсхолдер — ошибка в тесте).

**Interfaces:**
- Produces (`learning-replies.ts`): `fillPrompt`, `parseResult(text: string): unknown | null` (последний `<result>`), и разборщики, каждый возвращает значение или `null` при неверной форме, выбрасывая неизвестные поля:
  `parseMatch → MatchGroup[]`, `parseCaseAnalysis → { caseId: string; analysis: string }`, `parseBuild → BuildDraft`, `parseVerdicts → RuleVerdict[]`, `parseImprovement → Improvement`, `parseEdit → { files: PlaybookFiles; note: string | null; summary: string }`, `parseGrade → { critical: string[]; notes: string[] }` (то же для `parseReview`, `parseConsistency`), `parsePlan → { plan: string }`, `parseComparison → { winner: 'A' | 'B' | 'tie'; reason: string }`, `parseSelection → { playbookId: string | null }`, `parseDescription → { description: string }`.
- Входы промптов (имена плейсхолдеров — в тесте `learning-prompts`): matcher `{{new_case}}`, `{{candidates}}` (дайджесты), `{{playbooks}}` (id, description, тип); case-analyst `{{case_id}}`, `{{events}}` (raw по якорям), `{{summary}}`; builder `{{group}}`, `{{materials}}` (raw по якорям или разборы), `{{notes}}`, `{{existing}}` (описания других плейбуков); judge `{{rules}}`, `{{summary}}`, `{{events}}`; improver `{{playbook}}`, `{{summary}}`, `{{events}}`, `{{rejected}}`, `{{notes}}`; editor `{{object}}`, `{{files}}`, `{{message}}`, `{{notes}}`; grader `{{playbook}}`, `{{evidence}}`; reviewer `{{playbook}}`, `{{cases}}`; consistency `{{playbook}}`, `{{others}}`, `{{notes}}`, `{{duplicates}}`; planner `{{task}}`, `{{playbook}}` (или `(none)`); comparator `{{task}}`, `{{accepted}}`, `{{plan_a}}`, `{{plan_b}}`; selector `{{playbooks}}`, `{{message}}`; description-improver `{{playbook}}`, `{{misses}}`, `{{history}}`.
- Содержание своих промптов по спеке: сопоставитель отвечает группами с якорями общей части в каждом кейсе, кейс может быть в нескольких группах, большая сессия даёт только общую часть; сборщик делает повторяющееся шагом/источником/файлом/правилом, различающееся — параметром `{name}`, называет конкретные источники, файлы и роли; у правила — доказательства из кейсов; судья — вердикт по **каждому** правилу с якорем; улучшатель различает причины, `non_compliance` лечит механикой (гейт, пункт чеклиста), а не текстом, не предлагает правки из `{{rejected}}`; редактор возвращает изменённые файлы целиком и, если сообщение — указание «обращай внимание / не учитывай», — `note` для `notes.md`; планировщик строит план, ничего не исполняя.

- [ ] **Step 1: Тесты**: каждый промпт существует, первая строка — свой маркер, содержит все свои плейсхолдеры и ни одного чужого; `fillPrompt` не раскрывает плейсхолдеры внутри подставленных данных; для каждого разборщика — корректный ответ, ответ без `<result>`, JSON не той формы (→ `null`); `parseMatch` выбрасывает группы < 1 кейса и якоря, которые не разбирает `parseAnchor`; `parseBuild` без этапов → `null`.
- [ ] **Step 2:** падают; написать промпты и разборщики; `THIRD_PARTY_NOTICES.md` с тремя источниками, лицензиями и списком скопированных файлов; `npm run check` — PASS.
- [ ] **Step 3:** commit «Обучение, этап 2: промпты фоновых агентов и разбор ответов».

### Task 5: Хранилище плейбуков, git, журнал, публикация

**Files:**
- Create: `src/infrastructure/persistence/playbook-store.ts`; Modify: `src/infrastructure/persistence/learning-store.ts` (`writeNotes`, миграция jobs), `test/support/memory-learning-store.ts` (`writeNotes`), Create: `test/support/memory-playbook-store.ts`
- Test: `test/unit/infrastructure/playbook-store.test.ts`

**Interfaces:**
- Consumes: `PlaybookStorePort` (задача 1).
- Produces: `FilePlaybookStore(home: string, pluginDir: string)` — `<home>/playbooks/<id>/` (`playbook.json` = `PlaybookState`, файлы плейбука, `reviews/v<N>.json`, `chat.jsonl`), `<home>/learning/journal.jsonl`, чаты кейсов — `<home>/cases/<id>/chat.jsonl` (subject `c-…`). Git: `git init -q` при первом сохранении, `git -c user.name=nessy-orch -c user.email=nessy-orch@localhost commit -qam <message>`; номер версии — число коммитов; `restoreVersion` — содержимое файлов и `playbook.json` версии `N` через `git show <sha>:<path>` (новый коммит делает сервис через `savePlaybook`). Ошибка git — версия не создаётся, `savePlaybook` бросает (вызывающий валит задание). `publish`: собирает во временной папке `<pluginDir>.tmp` плагин `{ .claude-plugin/plugin.json: {name: 'nessy-playbooks', version, description}, skills/<skillName>/… }` и атомарно меняет `pluginDir` (rename старого в `.old`, нового на место, удалить `.old`); пустой список — папка удаляется.
- Конфиг: `OrchSettings.playbooksPluginDir?: string` (по умолчанию `~/.claude/skills/nessy-playbooks`), `ORCH_PLAYBOOKS_PLUGIN_DIR`; стенд тестов — папка внутри `base`.

- [ ] **Step 1: Тесты** (tmp): сохранить → версия 1, изменить → 2, `versions` по порядку, `restoreVersion(id, 1)` возвращает прежние файлы и состояние; удалить; журнал: добавить, обновить `revertedBy`, `loadJournal(2)` — последние; чат — круг; `publish` двух плейбуков → `plugin.json` и `skills/<name>/SKILL.md`, повтор с одним — второй исчез, пустой — папки нет; путь id с `../` отклоняется.
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3:** commit «Обучение, этап 2: хранилище плейбуков с git, журнал, публикация nessy-playbooks».

### Task 6: Обработчики заданий и PlaybookService

**Files:**
- Create: `src/application/learning/handlers.types.ts`, `src/application/learning/playbook.service.ts`, `src/application/learning/collect.handler.ts` (перенос `execute` этапа 1), `src/application/learning/case-ready.ts` (`onCaseReady`: постановка `judge` и `match`, `merge` и `after` у `JobQueue` — см. задачи 7 и 9)
- Modify: `src/application/learning/learning.service.ts`, `src/application/learning/learning.types.ts` (`LearningDeps.playbookStore`, `LearningDeps.pluginVersion`)
- Test: `test/unit/application/learning-jobs.test.ts` (без ослабления), `test/unit/application/playbook-service.test.ts`

**Interfaces:**
- Produces (`handlers.types.ts`):
  ```ts
  export interface JobContext {
  	job: JobState
  	now(): number
  	settings(): LearningSettings
  	runAgent(name: string, title: string, prompt: string): Promise<{ agentId: string; text: string }>   // ok:false → throw; текст ответа сохраняется в runs/
  	prompt(name: string): string
  	cases: { get(id: string): CaseState | null; all(): CaseState[]; summary(id: string): string; notes(id: string): string; raw(id: string, from: number, to?: number): RawEvent[]; update(c: CaseState): void }
  	playbooks: PlaybookService
  	enqueue(kind: JobKind, subject: string, opts?: { caseId?: string; payload?: Record<string, unknown>; final?: boolean }): void
  }
  export interface JobHandler { kinds: readonly JobKind[]; run(ctx: JobContext): Promise<void> }   // исключение = провал задания (повторы этапа 1)
  ```
- `LearningService` вместо `execute` вызывает обработчик по `job.kind` (реестр `registerHandler(h: JobHandler)`); `collect`/`close` — `collect.handler.ts` (поведение этапа 1 без изменений). `runAgent` у контекста пишет `writeRun(subject, job.id, text)`; агент `name` — `<kind>-<subject>`, `title` — по-русски («Сопоставление кейсов», «Сборка плейбука <title>», «Ревью: ступень N», «Судья: <case>», …).
- Produces (`PlaybookService`): `load()`, `list(): PlaybookState[]`, `get(id)`, `detail(id): PlaybookDetail`, `create(draft: BuildDraft, group: MatchGroup, heldOut: string | null): PlaybookState` (статус `draft`, правила с доказательствами из ≥ 2 кейсов — `active`, иначе `candidate`; журнал `playbook_created`), `saveVersion(p: PlaybookState, message: string, journal?: Omit<JournalEntry, 'id' | 'ts'>)` (рендер → `savePlaybook` → `learning_playbook`), `setStatus(id, status, reason)`, `publishActive()` (`trial` и `active` — в плагин; вызывается при любой смене статуса), `revert(journalId: string): JournalEntry` (по виду записи: версия → `restoreVersion` предыдущей и новый коммит; статус → прежний статус; правило → прежний статус правила; запись получает `revertedBy`), `remove(id)`, `notes(id)`, `setNotes(id, text)`, `forCase(caseId): PlaybookState | null` (по `case.playbook`).
- В `ingest` этапа 1: событие `skill` с именем `nessy-playbooks:<name>` → `case.playbook = <id>@<version>` (первое за кейс; id по `skillName`).

- [ ] **Step 1: Тесты**: все тесты заданий этапа 1 зелёные после переноса; задание неизвестного вида → `error` «нет обработчика»; `PlaybookService`: `create` → `draft`, журнал, файлы в хранилище; `setStatus('active')` публикует, `setStatus('disabled')` убирает из публикации; `revert` записи `published` возвращает прежний статус и публикацию; `revert` версии восстанавливает файлы (версия растёт); кейс с событием `skill` `nessy-playbooks:p-aff` получает `playbook: 'p-aff@1'`.
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3:** commit «Обучение, этап 2: обработчики заданий и сервис плейбуков».

### Task 7: Сопоставитель и сборщик плейбука

**Files:**
- Create: `src/application/learning/match.handler.ts`, `src/application/learning/build.handler.ts`
- Test: `test/unit/application/learning-match-build.test.ts`

**Interfaces:**
- Consumes: `JobContext`, `PlaybookService`, `buildIndex/search/caseDigest`, `parseAnchor/mergeRanges`, `parseMatch/parseCaseAnalysis/parseBuild`, `renderPlaybook`.
- Постановку `match` делает `onCaseReady` задачи 6: `enqueue('match', 'all', { payload: { caseIds: [id] } })`; при дедупликации `queued`-задания `match` списки `caseIds` объединяются (`JobQueue.enqueue` получает `merge?: (a, b) => payload`). Бэкфилл пачки ставит **один** `match` после последнего кейса пачки (`payload.after: string[]` — `next()` пропускает задание, пока кейсы пачки не станут `ready`/`error`). Задача 7 реализует только обработчик.
- `match`: для каждого нового кейса — 20 ближайших `ready`-кейсов поиском по `caseDigest` + все плейбуки (`id`, `description`, `taskType`); один агент `matcher` на всё задание. Группа с `playbookId` → кейс добавляется в `cases` плейбука (новая версия не создаётся), а если у кейса есть поправки (`countCorrections > 0`) и `case.playbook` совпадает — `improve` (задача 9). Группа без плейбука и ≥ 3 кейса → `enqueue('build', 'g-<hash кейсов>', { payload: group })`; хэш — от отсортированных id, повтор той же группы не ставится (`hasJob` или уже есть плейбук с тем же набором).
- `build`: отложенный кейс `heldOut` — самый свежий кейс группы, если в ней ≥ 3 (сборка по остальным). Материалы — `readRaw` по `mergeRanges(якоря, pad 3)` каждого кейса через `renderPortion`. Сумма ≤ `BUILD_CHARS = 300_000` → один агент `playbook-builder`; больше → агент `case-analyst` на кейс (каждый ≤ `PORTION_CHARS`), затем `playbook-builder` по разборам. Ответ → `PlaybookService.create` → `enqueue('review', id)`.

- [ ] **Step 1: Тесты** (фейковые `runAgent` по маркеру промпта): три кейса одной задачи → `match` → `build` → плейбук `draft` с 2 кейсами сборки и `heldOut` → задание `review` поставлено; группа из 2 → сборки нет; повтор той же группы → второй сборки нет; группа к существующему плейбуку → кейс в `cases`, версия та же; большие материалы → 2 вызова `case-analyst` и 1 `playbook-builder`; бэкфилл 5 кейсов → один `match` после всех; ответ сопоставителя без `<result>` → задание с повтором, плейбуков нет.
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3:** commit «Обучение, этап 2: сопоставитель и сборщик плейбука».

### Task 8: Авто-ревью, шесть ступеней

**Files:**
- Create: `src/application/learning/review.handler.ts`
- Test: `test/unit/application/learning-review-pipeline.test.ts`

**Interfaces:**
- Consumes: `lintPlaybook`, `similarity`, `parseGrade/parseReview/parseConsistency/parsePlan/parseComparison/parseSelection/parseDescription`, `PlaybookService`.
- `review` над плейбуком (новым или новой версией правок): ступени по порядку, отчёт каждой — `StageReport`; провал ступени 1–4 (есть `critical`) останавливает следующие.
  1. `lintPlaybook` (кейсы из хранилища).
  2. `grader`: плейбук + доказательства (raw по якорям правил и шагов).
  3. `reviewer`: два вердикта — соответствие сессиям группы; качество и обобщение; critical — только «не следует из сессий» или «вредно».
  4. `consistency`: другие `active`/`trial` плейбуки, их правила, заметки пользователя; почти-дубли (`similarity` описаний и правил ≥ 0.6) подаются списком.
  5. Нет `heldOut` → `skip`. Иначе 3 прогона: `planner` с плейбуком и без (задача — первые сообщения пользователя по якорю первой цели кейса), `comparator` вслепую (A/B случайно; эталон — описание кейса: что пользователь в итоге принял); `pass`, если побед и ничьих плейбука ≥ 2 из 3.
  6. `selector`: список описаний всех `active`/`trial` плейбуков + этого; сообщения — первые сообщения кейсов группы (должен выбрать этот) и до 5 кейсов других типов (не должен). `pass` при попаданиях ≥ 2/3 своих и ложных ≤ 1. Провал → один раз `description-improver` → новое описание → ступень 6 повторно; провал снова — `note`, не `critical` (мягкий порог).
- Итог: прошёл → `trial` (`trial.before` = среднее `countCorrections` кейсов группы), журнал `review_passed`, публикация. Не прошёл → `review` (ждёт человека), журнал `review_failed` с отчётом. `autoReview: false` → ступени не запускаются, статус `review`.
- Ручное решение (API задачи 10): `approve(id)` → `trial`, `reject(id, reason)` → `disabled`; правки улучшателя, отклонённые ревью или человеком, — хэш в `rejectedEdits`.

- [ ] **Step 1: Тесты** (фейковый `runAgent`): всё `pass` → `trial`, опубликован, журнал `review_passed` с 6 отчётами; critical на ступени 2 → ступени 3–6 не запускались, статус `review`; ступень 5: 2 победы из 3 → `pass`, 1 → `fail`; ступень 6 проваливается, после `description-improver` проходит → описание обновлено, новая версия; `autoReview: false` → без агентов, `review`; ревью не уходит в цикл (повторный провал — задание `done`, без новой постановки).
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3:** commit «Обучение, этап 2: авто-ревью плейбука в шесть ступеней».

### Task 9: Судья, счётчики, пробный режим, улучшение

**Files:**
- Create: `src/application/learning/judge.handler.ts`, `src/application/learning/improve.handler.ts`
- Test: `test/unit/application/learning-judge-improve.test.ts`

**Interfaces:**
- Постановку `judge` делает `onCaseReady` задачи 6 (кейс окончательно `ready` и `case.playbook` задан; повторное закрытие — снова, вердикты заменяются).
- `judge`: правила плейбука (`active` и `candidate`) + описание + raw по якорям поправок → `parseVerdicts` → `applyVerdicts` → `promoteCandidates` → новая версия, если что-то изменилось (журнал `rule_activated` / `rule_archived` на каждое изменение статуса правила). Пробный режим: плейбук `trial` → кейс добавляется в `trial.cases`/`corrections`; `trialDecision` `fail` → `disabled` + журнал `trial_failed`; `pass` → `active` + журнал `trial_passed`.
- После судьи: `countCorrections > 0` → `enqueue('improve', caseId, { caseId })`.
- `improve`: плейбук, описание, raw по якорям поправок, `rejectedEdits`, заметки → `parseImprovement`. `one_off` → ничего. Правки (`edits`) применяются к файлам как замена `before` → `after` (не нашлось `before` — правка отбрасывается с note); кандидаты → в правила `candidate` (или в `evidence` существующего кандидата с тем же текстом по `similarity ≥ 0.8`). Есть изменения → новая версия-кандидат и `review` (ступени 1–4; 5–6 при наличии `heldOut`); не прошло — версия откатывается, хэши правок в `rejectedEdits`.

- [ ] **Step 1: Тесты**: кейс с `playbook` закрыт → судья: 1 `applied`, 1 `violated` → счётчики `up 3`, `down 1`; повторное закрытие того же кейса → те же числа; кандидат получает второй кейс «за» → `active`, журнал; пробный режим: три кейса с поправками `[3,3,3]` при `before 1` → `disabled`, плагин без него; улучшение: правка с найденным `before` → новая версия → ревью; отклонённая правка не предлагается (её хэш в промпте `{{rejected}}`, а повтор той же правки отбрасывается кодом).
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3:** commit «Обучение, этап 2: судья, счётчики правил, пробный режим, улучшение».

### Task 10: Подключение, API, CLI, заметки и чат

**Files:**
- Modify: `src/app.ts`, `src/application/orchestrator.ts`, `src/application/settings.types.ts`, `src/infrastructure/config/load-config.ts`, `test/support/harness.ts`, `src/interfaces/http/routes/learning.routes.ts`, `src/interfaces/http/parsers.ts`, `src/interfaces/cli/commands/learning.commands.ts`, `src/interfaces/cli/format.ts`, `src/interfaces/cli/help.ts`
- Create: `src/application/learning/edit.handler.ts`
- Test: `test/integration/learning-playbooks.test.ts`, `test/unit/application/learning-edit.test.ts`

**Interfaces:**
- Маршруты (не-GET — оператор):

  | Метод и путь | Что делает |
  |---|---|
  | `GET /learning/playbooks` | `PlaybookView[]` |
  | `GET /learning/playbooks/:id` | `PlaybookDetail` |
  | `POST /learning/playbooks/:id/review` | поставить `review` (ручной запуск ревью) |
  | `POST /learning/playbooks/:id/approve` · `/reject {reason}` | ручное решение |
  | `POST /learning/playbooks/:id/status {status}` | `active` / `disabled` / `archived` вручную |
  | `POST /learning/playbooks/:id/revert {version}` | откат к версии (новая версия) |
  | `DELETE /learning/playbooks/:id` | удалить (идёт задание — 409) |
  | `PUT /learning/playbooks/:id/notes {text}` · `PUT /learning/cases/:id/notes {text}` | заметки пользователя |
  | `GET /learning/journal?limit=` · `POST /learning/journal/:id/revert` | журнал и откат решения |
  | `GET /learning/chat/:subject` · `POST /learning/chat/:subject {text}` | чат кейса (`c-…`) или плейбука (`p-…`) |
- `edit` (чат): сообщение пользователя → `ChatMessage` в чат → задание `edit` → агент `editor` с файлами объекта → изменённые файлы: у плейбука — новая версия (журнал `edit`), у кейса — `summary.md`; `note` дописывается в `notes.md` строкой `- <дата>: <note>`; ответ агента (`summary` и список изменённых файлов) — `ChatMessage` от `agent`. Заметки передаются всем следующим сборщикам, судьям и ревьюерам этого объекта (плейсхолдер `{{notes}}`), у плейбука — и заметки его кейсов не передаются.
- CLI: `nessy-orch playbook ls | show <id> | review <id> | approve <id> | reject <id> [--reason] | revert <id> --version N | rm <id>`, `nessy-orch learn journal [--revert <id>]`, `nessy-orch case note <id> "<текст>"`, `nessy-orch playbook note <id> "<текст>"`; `--json` у чтений.
- Подключение: `FilePlaybookStore(config.home, config.playbooksPluginDir ?? ~/.claude/skills/nessy-playbooks)`, `pluginVersion` — `'1.0.' + <число публикаций>` (Claude Code перечитывает плагин по версии), регистрация всех обработчиков, `playbooks` и `journal` в `LearningView`.

- [ ] **Step 1: Тесты**: интеграционный сквозной (стенд с `learningDefaultOn: true`, сценарии фейкового nessy по маркерам задачи 4): 3 сессии с одной задачей → 3 кейса `ready` → `match` → `build` → `review` (все ступени `pass`) → плейбук `trial`, `plugin.json` и `skills/<name>/SKILL.md` в папке плагина стенда; `POST /learning/journal/:id/revert` записи `published` → плагин пуст; чат плейбука «always check X» → новая версия и строка в `notes.md`; CLI `playbook ls` печатает таблицу; не-GET без токена — 403. Юнит `edit`: правка кейса меняет `summary.md`, не трогая курсор.
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3:** commit «Обучение, этап 2: API и CLI плейбуков, журнал, заметки, чат».

### Task 11: Подсказка плейбука через UserPromptSubmit

**Files:**
- Modify: `plugins/nessy/hooks/hooks.json`, `src/interfaces/cli/commands/hook.commands.ts`, `src/interfaces/cli/hook-context.ts`
- Create: `src/interfaces/http/routes/learning-hint.routes.ts` (регистрация в `server.ts`), `src/application/learning/hint.ts`
- Test: `test/unit/application/learning-hint.test.ts`, `test/unit/interfaces/hook-context.test.ts` (дополнить), `test/integration/sessions.test.ts` (дополнить)

**Interfaces:**
- Хук: `UserPromptSubmit` → `[ -z "${NESSY_ORCH_SESSION}" ] || "${CLAUDE_PLUGIN_ROOT}/bin/nessy-orch" hook prompt`, `timeout 5`. `hook prompt` читает `prompt` из stdin, `POST /learning/hint {session, prompt}` с бюджетом 1500 мс; ответ `{ playbook: { id, skill, title } | null }`; есть плейбук — stdout `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<hintContext>"}}`; ошибка, таймаут, пусто — ничего не печатает, код 0.
- `hintContext(skill: string, title: string): string` (`hook-context.ts`): одна-две строки по-русски: похоже на задачу плейбука «<title>»; загрузи скилл `<skill>` инструментом Skill и иди по нему, если задача та же.
- `hint.ts`: `suggest(input: { session: string; prompt: string; caseGoalTypes: string[] }, playbooks: PlaybookState[], hinted: ReadonlySet<string>): PlaybookState | null` — только `trial`/`active`; поиск `search` по `description + taskType + title` по тексту запроса и типам целей текущего кейса сессии; порог `score ≥ HINT_MIN_SCORE = 2.5` (подобрать в тесте на образцах); плейбук, уже подсказанный в этой цепочке сессий или уже загруженный (`case.playbook`), не подсказывается снова. Сборщик, увидев новую цель с типом, совпадающим с `taskType` плейбука, кладёт подсказку в очередь сессии — её отдаст ближайший `hint`, даже если текст запроса не совпал.
- Хранение подсказанного — в `CaseState.hinted: string[]` (новое поле, миграция `[]`).

- [ ] **Step 1: Тесты**: `suggest` на 3 плейбуках выбирает верный по «реализуй aff пакет для X», не выбирает ничего по «привет»; второй раз тот же — `null`; подсказка от сборщика отдаётся по нерелевантному запросу один раз; `hintContext` содержит имя скилла и «инструментом Skill»; `hook prompt` при недоступном сервере — пустой stdout, код 0, время < 2 с; интеграционный: с плейбуком `active` хук печатает `additionalContext`.
- [ ] **Step 2:** падают; реализовать; `npm run check` — PASS.
- [ ] **Step 3: Документация**: README и `docs/api.md` (плейбуки, журнал, чат, подсказка, папка плагина), `CLAUDE.md` (три хука плагина; модуль плейбуков), `plugins/nessy/hooks/hooks.json` — описание.
- [ ] **Step 4:** commit «Обучение, этап 2: подсказка плейбука через UserPromptSubmit».

---

## Порядок волн для исполнителей

1. Задача 1 (одна).
2. Задачи 2, 3, 4, 5 — параллельно (файлы не пересекаются; 3 правит `transcript.ts`, `case-events.ts`, `learning.types.ts` домена — больше никто).
3. Задача 6 (одна).
4. Задачи 7, 8, 9 — параллельно (каждая — свой обработчик и тест). Постановку заданий после готовности кейса делает задача 6: `case-ready.ts` с `onCaseReady(ctx, caseId)` — `judge`, если у кейса есть `playbook`, затем `match` (с объединением `caseIds` и ожиданием пачки бэкфилла, `JobQueue.enqueue(..., merge)`); `improve` ставит обработчик `judge` (задача 9).
5. Задачи 10 и 11 — параллельно (11 — свой файл маршрутов).
6. Итоговое ревью ветки.

## Что остаётся этапу 3

Вкладка «Фон» в приложении: работа, кейсы, плейбуки, журнал, настройки, чат; чип плейбука в шапке сессии; меню сессии; строка «пока вас не было». Проверка второго skills-dir плагина `nessy-playbooks` в настоящем Claude Code (риск спеки) — вручную после этапа 2.
