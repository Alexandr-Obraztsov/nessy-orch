# Архитектура

Сервер — TypeScript без рантайм-зависимостей (только стандартная библиотека Node). Код разделён на слои
(clean architecture), зависимости направлены внутрь. Типы лежат в отдельных файлах (`types.ts`, `*.types.ts`, `ports.ts`).

```
        you (CLI / UI / Claude Code)
              │  HTTP + SSE  127.0.0.1:4337
┌─────────────▼───────────────────────────────────────────────────────┐
│ interfaces/http   router, guard (Host/Origin), parsers, routes/*,    │
│                   sse-endpoints, static-files          interfaces/cli│
├──────────────────────────────────────────────────────────────────────┤
│ application   Orchestrator (фасад)                                    │
│   ├─ services/  spaces · messaging · agents · roles                  │
│   ├─ agent/     Agent (очередь, ход, права) + AgentJournal (события) │
│   ├─ Feed (лента, wait, inbox)  Hub (шина, rev)  Registry            │
│   └─ ports.ts   NessyGateway, SpaceRuntime, StorePort, Clock, Ids    │
├──────────────────────────────────────────────────────────────────────┤
│ domain   чистая логика без IO: routing, rate-limiter, wait-graph,    │
│          agent-status, permission, preamble, roles, naming, errors   │
└──────────────────────────────────────────────────────────────────────┘
 infrastructure (реализации портов):
   nessy/        NessyClient + event-mapper + tool-output  ◄ единственное знание протокола nessy
   persistence/  FileStore (state.json, roles.json, JSONL)
   process/      ServeSpace (процесс `nessy serve`), free-port
   sse/          парсер и форматтер SSE-кадров
   config/       loadConfig (переменные окружения)
              │ HTTP + SSE (loopback, порты 4360+)
        nessy serve (по одному на space) ──► N сессий (= N агентов)
```

Общие типы контракта сервер ⇄ CLI ⇄ UI — `shared/types/` (`domain.ts`, `events.ts`, `api.ts`; только типы).
Утилиты без зависимостей от слоёв — `src/lib/` (`json`, `ids`, `text`, `async`).

## Composition root

- `src/main.ts` — точка входа демона: `loadConfig()` → `buildApp(config, version)` → `listen()` → `start()`.
  Порт занят — выход, ничего не запущено. `process.on('exit')` синхронно гасит дочерние serve (`killChildrenSync`);
  `uncaughtException` — лог и `exit(1)`; `SIGINT`/`SIGTERM` — корректная остановка (принудительный выход через 10 с).
- `src/app.ts` — `buildApp`: создаёт `FileStore`, `Orchestrator` (с фабрикой
  пространств `ServeSpace` + `NessyClient`), вызывает `orch.load()` (только чтение состояния, без побочных эффектов)
  и `createServer(...)`. Возвращает `{orch, server, listen, start, killChildrenSync, close}`; `start()` — после
  `listen()`: `orch.start()` (доставка восстановленных очередей). Используется и интеграционными тестами.

`Agent` не импортирует `Orchestrator`: он знает его через интерфейс `AgentHost` (`getSpace`, `labelOf`, `preambleFor`,
`onTurnDone`, `onUndeliverable`, `saveSoon`). Внешний мир ядро видит только через порты (`application/ports.ts`).

## Карта модулей

| Слой | Файлы |
|---|---|
| `domain/` | `routing.ts` (правила маршрутизации, hops, ответы, обрамление промпта), `rate-limiter.ts`, `wait-graph.ts` (детектор дедлоков), `agent-status.ts` (переходы статусов и архив), `permission.ts` (`pickPermissionOption`), `preamble.ts` (вводная агента), `plan.ts` (проверка плана, разбор чек-листа CLI, правило сброса), `roles.ts` (проверка ролей, slug, цвет), `naming.ts`, `errors.ts` (`AppError`), `constants.ts` (`YOU`, `SYSTEM`, `PALETTE`), `types.ts` |
| `application/` | `orchestrator.ts` (фасад, `AgentHost`, load/shutdown), `registry.ts` (пространства и агенты, разрешение ссылок), `feed.ts` (лента, ожидание ответов, inbox), `hub.ts` (шина событий с `rev`), `ports.ts`, `*.types.ts` |
| `application/agent/` | `agent.ts` (очередь, ход, подключение к nessy, права), `agent-journal.ts` (seq событий, блоки текста, инструменты) |
| `application/services/` | `spaces.service.ts`, `messaging.service.ts` (post/send/wait, interrupt, защиты), `agents.service.ts` (spawn/remove/cancel/archive/restore/history), `roles.service.ts` (CRUD ролей, roles.json, события) |
| `infrastructure/nessy/` | `nessy-client.ts` (HTTP-клиент `nessy serve`, подписка на SSE с переподключением), `event-mapper.ts` (кадры nessy → `SessionEvent`), `tool-output.ts` (`buildToolOutput`), `protocol.types.ts` |
| `infrastructure/persistence/` | `file-store.ts` (`StorePort`), `jsonl.ts` |
| `infrastructure/process/` | `serve-space.ts` (`SpaceRuntime`), `free-port.ts` |
| `infrastructure/sse/` | `sse-parser.ts`, `sse-format.ts` (`formatFrame`) |
| `infrastructure/config/` | `load-config.ts`, `config.types.ts` |
| `interfaces/http/` | `server.ts`, `router.ts`, `guard.ts`, `parsers.ts`, `respond.ts`, `sse-endpoints.ts`, `static-files.ts`, `routes/{system,spaces,agents,roles,messages}.routes.ts` |
| `interfaces/cli/` | `main.ts`, `args.ts`, `client.ts` (клиент HTTP API), `commands/{agents,feed,roles,service,spaces}.commands.ts`, `format.ts`, `render-event.ts`, `help.ts`, `io.ts`, `errors.ts`, `launchd.ts` |

## Модель данных (`shared/types/`)

| Сущность | Ключевые поля |
|---|---|
| **Space** (`SpaceView`) | `name`, `path`, `color` (hue 0..360), `mode` (`managed`/`external`), `url`, `status` (`stopped`/`starting`/`ready`/`failed`), `error` |
| **Agent** (`AgentView`) | `id` (`a-xxxx`), `name` (уникально без учёта регистра, по умолчанию = id или id роли), `space`, `parent` (`you` или id), `role` (id роли или `null`), `status`, `archived`, `error`, `displayName` (авто-заголовок от nessy), `createdAt`, `lastActivityAt`, `queued`, `turnStartedAt`, `lastTool`, `preview`, `pendingPermissions[]` |
| **Role** (`RoleView`) | `id` (slug `[a-z0-9-]`, ≤ 40), `name` (≤ 60, уникально), `description`, `instructions` (≤ 20000), `color` (hue), `createdAt`, `updatedAt` |
| **Message** | `seq` (монотонный), `id` (`m-xxxxxx`), `ts`, `from`, `to`, `kind` (`msg`/`reply`/`event`), `text`, `hops`, `replyTo?`, `wait?`, `failed?` |
| **AgentEvent** (чат агента) | `user` · `text` · `thought` · `tool` · `permission` · `system`, у каждого `seq`, `ts` |

`ToolEvent.status` — ровно `pending | in_progress | completed | failed`. Узлы графа: `you` (предопределён) и агенты.
Системные сообщения имеют `from: "system"`. Рёбра графа: постоянное `parent → агент` + эфемерные `from → to` по каждому `Message`.

### Статусы агента

```
starting ──► idle ◄──► working ──► error (ход с ошибкой / упала сессия / не удалось подключиться)
               ▲                     │
               └──── следующее сообщение (новая сессия, если старой нет) ◄┘
```

Статусы — `starting | working | idle | error` (`domain/agent-status.ts`). Состояний сна и смерти нет: «навсегда мёртвых»
агентов не бывает.

- После подключения `starting|error → idle`. После хода: очередь не пуста → `working`; ошибка → `error` (текст в `error`);
  иначе `idle`.
- `session_died` (или 404 на events) → `error`; следующее сообщение создаёт новую сессию, в чат пишется
  «сессия nessy пересоздана, контекст сброшен».
- Рестарт: все агенты восстанавливаются `idle`; сессия поднимается лениво при первом сообщении (`/session/:id/load`, не вышло —
  новая с записью «контекст сброшен»).

**Архив** (`archived`, `archiveAfterTurn`): успешный ход (не ошибка и не прерывание) при пустой очереди уводит агента в архив —
он скрыт из рабочего списка UI и `nessy-orch ls` (видно с `--all`), но остаётся в графе/снапшоте, его сессия и подписка
живы. Любое сообщение (`Agent.deliver`) возвращает его из архива, контекст прежний. Ход с ошибкой оставляет агента на виду.
Вручную: `POST /agents/:ref/archive` (только когда агент не работает и очередь пуста, иначе `409 busy`) и `/restore`.
Флаг сохраняется в `state.json`. Агент без задачи (spawn без `prompt`) остаётся видимым `idle`.

## Маршрутизация сообщений

Правила описаны в шапке `domain/routing.ts`, исполняются `MessagingService`:

1. `you → агент` (`msg`): доставка в очередь агента; по окончании хода ответ → `you` (`reply`, виден в inbox и ленте).
2. `агент A → агент B` (`msg`): доставка B; по окончании хода ответ автоматически → A (`reply`) и доставляется A промптом
   `[ответ агента … на твоё сообщение]`. Если A отправил с `wait=true`, ответ возвращается в его shell-вызов и
   **не** доставляется ему промптом (`shouldDeliver`).
3. Ход, вызванный `reply`, ответа не порождает (`expectsReply`) — иначе пинг-понг. Системные сообщения тоже без ответа.
4. Защиты (`MessagingService.post`/`send`):
   - `hops` = длина цепочки; для сообщения агента `hops = hops текущего обрабатываемого сообщения + 1`, от `you` — 0;
     `> maxHops` → `429 hop_limit` (только для отправителей-агентов);
   - не более `rateLimitPerMinute` сообщений на пару `from>to` в скользящем окне 60 с → `429 rate_limit` (только для агентов);
   - `wait` между агентами с взаимным (в т.ч. транзитивным) ожиданием → `409 deadlock` (`WaitGraph`);
   - отправка себе → `400 self_send`; пустой текст → `400 empty_text`; неизвестный получатель → `404 no_agent`;
     неизвестный отправитель → `400 bad_from`; неоднозначное имя → `409 ambiguous_agent`.
5. Срочность: `SendRequest.interrupt` (по умолчанию `true` для `you`, `false` для агентов) — см. «Прерывание» ниже.

```
you ──send──► MessagingService.send ─► post ─► Feed.append ──► Agent.deliver ─► queue ─► pump ─► nessy /prompt
                                                                                               │
you ◄──inbox/feed/stream── Feed.append(reply) ◄── onTurnDone ◄── Agent.finishTurn ◄── turn_complete (SSE nessy)
```

### Очередь и ход (`Agent`)

- `deliver(msg)` кладёт сообщение в `queue`; `pump()` берёт следующее, когда нет текущего хода. Перед первым промптом
  сессии добавляется вводная (`buildPreamble`): кто ты, id, как написать другим через
  `nessy-orch send --from <id> [--wait] <кому> "текст"`, список коллег. Флаг `introduced` хранится в state и сбрасывается,
  если сессия создана заново.
- События nessy приходят от `NessyClient.subscribe` уже нормализованными (`SessionEvent`). `AgentJournal` присваивает `seq`:
  потоковый `text`/`thought` копится в блоке (`chunk` в шину, итог в файл при смене вида/`messageId` или конце хода),
  `tool` обновляется повторной записью **с тем же `seq`** (при чтении побеждает последняя запись с данным `seq`).
  Вывод инструмента обрезается до 4000 символов. Незавершённые инструменты при ошибке/отмене хода получают `failed`.
- События вне хода (реплей `Last-Event-ID`) игнорируются: `text`/`thought`, а также обновления неизвестных инструментов.
- Ход завершается по `turn_complete` (с проверкой `promptId`), `prompt_cancelled` (`stopReason: cancelled`), `session_died`
  или по ошибке отправки промпта. `turn_error` (мета `nessy/error`) запоминается и попадает в итог хода как ошибка.
- Временный отказ nessy на промпт (`prompt_queue_full`, `session_busy`, 429, 503 → `NessyBusyError`): до 5 повторов с паузой
  (`Retry-After` или 1 с × 2ⁿ, не больше 30 с), в чат пишется «nessy занят»; отмена хода прекращает повторы. Прочие ошибки — сразу `error`.
- `client_evicted` — отцепиться и подключиться заново (сначала `/load`). Падение `nessy serve` — `onSpaceDown`: ход с ошибкой,
  сессия поднимется при следующем сообщении.
- `permission_request`: при `autoApprove` — голос через `pickPermissionOption` (`allow_once` предпочтительнее) и запись
  в события агента (`auto: true`); иначе запрос ждёт в `pendingPermissions` до `POST /agents/:ref/permission/:requestId`.
  Нерешённые запросы сбрасываются в конце хода.
- `cancel()` очищает очередь и отправляет `cancel` в nessy; удаление агента — отмена, закрытие сессии, архив истории.

### Прерывание (interrupt)

`deliver(msg, interrupt=true)` ставит сообщение в начало очереди (после ранее пришедших срочных — счётчик `urgent`) и,
если идёт ход, запрашивает отмену (`requestCancel`). Гонок нет: следующий промпт уходит из `pump()` только когда текущий ход
закрыт — по `cancelled`/`turn_complete` прерванного промпта. Если nessy не подтвердил отмену за `cancelGraceMs` (3 с), ход
закрывается принудительно, а события старого промпта игнорируются до принятия нового (`staleEvents`); поздние
`turn_complete`/`cancelled` с `promptId` уже закрытых ходов отбрасываются всегда (`donePrompts`). Если прерывание пришло, пока
промпт ещё летит в nessy, `cancel` отправляется сразу после его принятия. Ожидающий отправитель прерванного хода получает
обычный ответ с `(ход прерван)` в конце.

### Роли

`RolesService` хранит роли в `<home>/roles.json` (атомарная запись при каждом изменении), публикует `{t:'role'}` /
`{t:'role_removed'}` в шину, снапшот и `GraphView` содержат `roles`. Проверки — `domain/roles.ts` (id из имени
транслитерацией кириллицы, цвет — хеш имени). `spawn` с `role` (id или имя) записывает `agent.role = id`, имя по умолчанию —
id роли (`reviewer`, `reviewer-2`, …), а `preambleFor` добавляет во вводную «Твоя роль: <имя>» и инструкции. Удаление роли
агентов не трогает: у них остаётся id, вводная — без раздела роли.

### Сессии, источники, счётчики

`SessionsService` хранит сессии оркестраторов в `<home>/sessions.json`: сессия — один разговор Claude, агенты привязаны к ней
(`Agent.session`; агент, запущенный агентом, наследует сессию родителя), у неё свой курсор inbox (`Feed`). Не путать с сессией nessy
(`Agent.nessyId`). `SourcesService` собирает источники сессии: ссылки из раздела «Источники» итоговых ответов (`domain/reply.ts`)
и ссылки из входа вызовов инструментов (`domain/sources.ts`); дедупликация по ключу, хранение построчно в `sources/<сессия>.jsonl`,
счётчик — в `SessionView.sources`. `Agent.stats` считает ходы, вызовы инструментов, время и токены (`usage` из `turn_complete` или
`GET /session/:id/stats`); `ReplyBrief.status` — статус из последней строки ответа. Ход «в полёте» при рестарте помечается потерянным
(`PersistedAgent.inflight`) и завершается ошибкой при `start()`.

### Ожидание (`--wait`)

`send(..., wait:true)` ждёт ответ через `Feed.waitReply(message.id)`; `Feed.append(reply)` с `replyTo` будит ожидающего.
Таймаут (`waitTimeoutSec`, по умолчанию 600) возвращает `timedOut:true`, агент продолжает работу. Ожидающие агенты учитываются
в `WaitGraph` для детектора дедлоков.

### Inbox

`GET /inbox` отдаёт сообщения `to === you && kind === 'reply'` новее курсора; курсор хранится в `state.json`
(`inboxCursor`) и сдвигается при чтении без `peek`/`after`. `wait=N` — long-poll до N секунд.

## Шина событий и потоки

`Hub` нумерует события монотонным `rev` и рассылает подписчикам (`HubEvent`). `/stream` отдаёт снапшот и события графа и
ленты; события чата агентов (`event`/`chunk`) туда не попадают, они идут в `/agents/:ref/stream`
(см. [api.md](api.md)). Незавершённый блок текста на подключении отдаётся одним `chunk`.

## Пространства (`ServeSpace`)

- `managed`: `nessy serve --port <свободный из 4360+> --hostname 127.0.0.1 --no-web --workspace <path> --max-sessions N`
  (+ `NESSY_SERVE_ARGS`). Процесс поднимается лениво при первом обращении (`ensureReady`). Вывод в
  `~/.nessy-orch/logs/space-<имя>.log`. Готовность — опрос `GET /health`, таймаут `ORCH_HEALTH_TIMEOUT_MS` (60 с).
  Остановка: `SIGTERM`, через 5 с `SIGKILL`.
- `external`: уже запущенный демон по `url` (оркестратор его не запускает и не останавливает).
- Неожиданный выход процесса → `status: failed`, у агентов space вызывается `onSpaceDown`. Следующее сообщение агенту
  вызывает `ensureReady()` и пересоздаёт serve; сессия поднимается через `POST /session/:id/load`, а если не вышло —
  создаётся новая (контекст сброшен, в чат пишется системная запись).
- Один `nessy serve` привязан ровно к одному воркспейсу (`workspace_mismatch`) — поэтому space = воркспейс.
- Протокол nessy знают только `infrastructure/nessy/*`; контракт — [contract/README.md](contract/README.md).

## Хранение (`~/.nessy-orch/`, переопределяется `NESSY_ORCH_HOME`)

| Файл | Содержимое |
|---|---|
| `state.json` | `spaces[]`, `agents[]` (вкл. `sessionId`, `lastEventId`, `queue`, `introduced`, `evSeq`, `role`, `archived`), `msgSeq`, `inboxCursor`. Запись отложенная (200 мс), атомарная (tmp + rename) |
| `roles.json` | `{roles: RoleView[]}`; атомарная запись при каждом изменении |
| `messages.jsonl` | лента сообщений, append-only; при старте читаются последние 5000 |
| `agents/<id>.jsonl` | события агента, append-only; удалённый агент → `<id>.jsonl.removed` |
| `logs/space-<имя>.log` | stdout/stderr процесса `nessy serve` |

Рестарт оркестратора (`sessions.json` читается и из прежнего `tasks.json`): пространства, роли, сессии и агенты восстанавливаются (агенты `idle`, флаг `archived` сохраняется), лента и очереди
сохраняются, сообщения из очереди доставляются после того, как HTTP начал слушать (`orch.start()` → `resumeQueue`, по одному агенту). Ход, который был «в полёте» в момент остановки,
**теряется**: отправитель получает ответ с ошибкой, в чате агента — пометка.

## Защита HTTP

`interfaces/http/guard.ts`: `Host` обязан быть `127.0.0.1|localhost|[::1]:<порт>` (`403 bad_host`), `Origin` — только
`http://127.0.0.1:<порт>` или `http://localhost:<порт>` (`403 bad_origin`). Тело запроса ограничено 5 МБ (`413 too_large`).
Статика UI защищена от выхода за каталог (`403 forbidden`).

## Конфигурация (переменные окружения, `loadConfig`)

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `ORCH_PORT` | 4337 | порт API/UI (хост всегда `127.0.0.1`) |
| `NESSY_ORCH_HOME` | `~/.nessy-orch` | каталог состояния |
| `NESSY_BIN` | `~/.local/bin/nessy` | бинарь nessy |
| `NESSY_SERVE_ARGS` | — | доп. аргументы `nessy serve` |
| `SERVE_BASE_PORT` | 4360 | начало пула портов для serve |
| `MAX_SESSIONS` | 20 | `--max-sessions` для serve |
| `ORCH_AUTO_APPROVE` | 1 | автоподтверждение прав агентов |
| `ORCH_MAX_HOPS` | 8 | максимальная длина цепочки |
| `ORCH_RATE_LIMIT` | 30 | сообщений в минуту на пару |
| `ORCH_HEALTH_TIMEOUT_MS` | 60000 | ожидание готовности serve |
| `ORCH_UI_DIR` | `<проект>/ui/dist` | каталог собранного UI для статики |

## Структура репозитория

```
bin/            nessy-orch (обёртка над dist/), nessy-ask|jobs|watch (алиасы совместимости)
shared/types/   общие типы (сервер, CLI, UI): domain, events, api
src/            сервер и CLI (слои — выше); сборка в dist/src/
test/           unit/ (lib, domain, application, infrastructure, interfaces), integration/, support/ (фейковый nessy serve, стенд)
e2e/            Playwright-сценарии UI
ui/src/         React + Vite, Feature-Sliced Design (app, widgets, features, entities, shared)
docs/           эта документация + contract/ (референс протокола nessy)
scripts/        postbuild.mjs (exec-биты)
```

## Качество кода

- `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `useUnknownInCatchVariables`.
- ESLint `strictTypeChecked`: запрещены `any`, `no-unsafe-*`, `@ts-ignore`, `no-floating-promises`, обязателен `import type`.
- Внешний JSON читается только через хелперы `src/lib/json.ts`.
- Проверка: `npm run check` (typecheck + lint + test); e2e UI — `npm run test:e2e`.
