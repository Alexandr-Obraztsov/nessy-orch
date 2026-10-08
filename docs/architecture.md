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
│   ├─ services/  spaces · messaging · agents                          │
│   ├─ agent/     Agent (очередь, ход, права) + AgentJournal (события) │
│   ├─ Feed (лента, wait, inbox)  Hub (шина, rev)  Registry            │
│   └─ ports.ts   NessyGateway, SpaceRuntime, StorePort, Clock, Ids    │
├──────────────────────────────────────────────────────────────────────┤
│ domain   чистая логика без IO: routing, rate-limiter, wait-graph,    │
│          agent-status, permission, preamble, naming, errors          │
└──────────────────────────────────────────────────────────────────────┘
 infrastructure (реализации портов):
   nessy/        NessyClient + event-mapper + tool-output  ◄ единственное знание протокола nessy
   persistence/  FileStore (state.json, JSONL)
   process/      ServeSpace (процесс `nessy serve`), free-port
   sse/          парсер и форматтер SSE-кадров
   config/       loadConfig (переменные окружения)
              │ HTTP + SSE (loopback, порты 4360+)
        nessy serve (по одному на space) ──► N сессий (= N агентов)
```

Общие типы контракта сервер ⇄ CLI ⇄ UI — `shared/types/` (`domain.ts`, `events.ts`, `api.ts`; только типы).
Утилиты без зависимостей от слоёв — `src/lib/` (`json`, `ids`, `text`, `async`).

## Composition root

- `src/main.ts` — точка входа демона: `loadConfig()` → `buildApp(config, version)` → `listen()`; обработка
  `SIGINT`/`SIGTERM` (корректная остановка, принудительный выход через 10 с).
- `src/app.ts` — `buildApp`: создаёт `FileStore`, `Orchestrator` (с фабрикой пространств `ServeSpace` +
  `NessyClient`), вызывает `orch.load()` и `createServer(...)`. Возвращает `{orch, server, listen, close}`;
  используется и интеграционными тестами.

`Agent` не импортирует `Orchestrator`: он знает его через интерфейс `AgentHost` (`getSpace`, `labelOf`, `preambleFor`,
`onTurnDone`, `onUndeliverable`, `saveSoon`). Внешний мир ядро видит только через порты (`application/ports.ts`).

## Карта модулей

| Слой | Файлы |
|---|---|
| `domain/` | `routing.ts` (правила маршрутизации, hops, ответы, обрамление промпта), `rate-limiter.ts`, `wait-graph.ts` (детектор дедлоков), `agent-status.ts` (переходы статусов), `permission.ts` (`pickPermissionOption`), `preamble.ts` (вводная агента), `naming.ts`, `errors.ts` (`AppError`), `constants.ts` (`YOU`, `SYSTEM`, `PALETTE`), `types.ts` |
| `application/` | `orchestrator.ts` (фасад, `AgentHost`, load/shutdown), `registry.ts` (пространства и агенты, разрешение ссылок), `feed.ts` (лента, ожидание ответов, inbox), `hub.ts` (шина событий с `rev`), `ports.ts`, `*.types.ts` |
| `application/agent/` | `agent.ts` (очередь, ход, подключение к nessy, права), `agent-journal.ts` (seq событий, блоки текста, инструменты) |
| `application/services/` | `spaces.service.ts`, `messaging.service.ts` (post/send/wait, защиты), `agents.service.ts` (spawn/remove/cancel/history) |
| `infrastructure/nessy/` | `nessy-client.ts` (HTTP-клиент `nessy serve`, подписка на SSE с переподключением), `event-mapper.ts` (кадры nessy → `SessionEvent`), `tool-output.ts` (`buildToolOutput`), `protocol.types.ts` |
| `infrastructure/persistence/` | `file-store.ts` (`StorePort`), `jsonl.ts` |
| `infrastructure/process/` | `serve-space.ts` (`SpaceRuntime`), `free-port.ts` |
| `infrastructure/sse/` | `sse-parser.ts`, `sse-format.ts` (`formatFrame`) |
| `infrastructure/config/` | `load-config.ts`, `config.types.ts` |
| `interfaces/http/` | `server.ts`, `router.ts`, `guard.ts`, `parsers.ts`, `respond.ts`, `sse-endpoints.ts`, `static-files.ts`, `routes/{system,spaces,agents,messages}.routes.ts` |
| `interfaces/cli/` | `main.ts`, `args.ts`, `client.ts` (клиент HTTP API), `commands/{agents,feed,service,spaces}.commands.ts`, `format.ts`, `render-event.ts`, `help.ts`, `io.ts`, `errors.ts`, `launchd.ts` |

## Модель данных (`shared/types/`)

| Сущность | Ключевые поля |
|---|---|
| **Space** (`SpaceView`) | `name`, `path`, `color` (hue 0..360), `mode` (`managed`/`external`), `url`, `status` (`stopped`/`starting`/`ready`/`failed`), `error` |
| **Agent** (`AgentView`) | `id` (`a-xxxx`), `name` (уникально без учёта регистра, по умолчанию = id), `space`, `parent` (`you` или id), `status`, `error`, `displayName` (авто-заголовок от nessy), `createdAt`, `lastActivityAt`, `queued`, `turnStartedAt`, `lastTool`, `preview`, `pendingPermissions[]` |
| **Message** | `seq` (монотонный), `id` (`m-xxxxxx`), `ts`, `from`, `to`, `kind` (`msg`/`reply`/`event`), `text`, `hops`, `replyTo?`, `wait?`, `failed?` |
| **AgentEvent** (чат агента) | `user` · `text` · `thought` · `tool` · `permission` · `system`, у каждого `seq`, `ts` |

`ToolEvent.status` — ровно `pending | in_progress | completed | failed`. Узлы графа: `you` (предопределён) и агенты.
Системные сообщения имеют `from: "system"`. Рёбра графа: постоянное `parent → агент` + эфемерные `from → to` по каждому `Message`.

### Статусы агента

```
starting ──► idle ◄──► working
   │           │          │
   │           └──► error (подключение не удалось; следующее обращение пробует снова)
sleeping  — восстановлен из state.json, к nessy не подключён; подключается при первом сообщении
dead      — сессия nessy умерла (session_died / 404 на events); сообщения ему не доставляются
```

Переходы — `domain/agent-status.ts`: после подключения `starting|sleeping|error → idle`; после хода `working`, если очередь
не пуста, иначе `idle` (`dead` остаётся `dead`); при рестарте `dead` остаётся, остальные становятся `sleeping`.
Ошибка хода (не подключения) статус `error` не ставит: ход завершается с `error` в ответе и системным событием в чате.

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
5. Агент в статусе `dead` недоставляемый: `onUndeliverable` пишет системное событие в ленту и формирует ответ-ошибку отправителю.

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
- `client_evicted` — отцепиться и подключиться заново. Падение `nessy serve` — `onSpaceDown`: ход с ошибкой, статус `sleeping`.
- `permission_request`: при `autoApprove` — голос через `pickPermissionOption` (`allow_once` предпочтительнее) и запись
  в события агента (`auto: true`); иначе запрос ждёт в `pendingPermissions` до `POST /agents/:ref/permission/:requestId`.
  Нерешённые запросы сбрасываются в конце хода.
- `cancel()` очищает очередь и отправляет `cancel` в nessy; удаление агента — отмена, закрытие сессии, архив истории.

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
| `state.json` | `spaces[]`, `agents[]` (вкл. `sessionId`, `lastEventId`, `queue`, `introduced`, `evSeq`), `msgSeq`, `inboxCursor`. Запись отложенная (200 мс), атомарная (tmp + rename) |
| `messages.jsonl` | лента сообщений, append-only; при старте читаются последние 5000 |
| `agents/<id>.jsonl` | события агента, append-only; удалённый агент → `<id>.jsonl.removed` |
| `logs/space-<имя>.log` | stdout/stderr процесса `nessy serve` |

Рестарт оркестратора: пространства и агенты восстанавливаются (агенты `sleeping`, `dead` остаётся), лента и очереди
сохраняются, сообщения из очереди доставляются сразу (`resumeQueue`). Ход, который был «в полёте» в момент остановки,
**теряется** (ответ не придёт).

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
