# Архитектура

```
        you (CLI / UI / Claude Code)
              │  HTTP + SSE  127.0.0.1:4337
┌─────────────▼──────────────────────────────────────────────┐
│ src/api/server.ts      маршруты, SSE, статика UI, Host/Origin│
├─────────────────────────────────────────────────────────────┤
│ src/core/orchestrator.ts   маршрутизация, лента, inbox, wait │
│   ├─ hub.ts       шина событий (rev-нумерация)               │
│   ├─ store.ts     state.json, messages.jsonl, agents/*.jsonl│
│   ├─ space.ts     воркспейс + процесс `nessy serve`          │
│   └─ agent.ts     сессия nessy, очередь, события, права      │
│        └─ nessy-client.ts  ЕДИНСТВЕННОЕ знание протокола nessy│
└─────────────┬───────────────────────────────────────────────┘
              │ HTTP + SSE (loopback, порты 4360+)
        nessy serve (по одному на space) ──► N сессий (= N агентов)
```

Слои зависят только вниз. `Agent` не импортирует `Orchestrator`: он знает его через интерфейс `AgentHost`
(`getSpace`, `labelOf`, `preambleFor`, `onTurnDone`, `onUndeliverable`, `saveSoon`).

## Модель данных (`shared/types.ts` — общий файл для сервера, CLI и UI)

| Сущность | Ключевые поля |
|---|---|
| **Space** (`SpaceView`) | `name`, `path`, `color` (hue 0..360), `mode` (`managed`/`external`), `url`, `status` (`stopped`/`starting`/`ready`/`failed`), `error` |
| **Agent** (`AgentView`) | `id` (`a-xxxx`), `name` (уникально, по умолчанию = id), `space`, `parent` (`you` или id), `status`, `displayName` (авто-заголовок от nessy), `queued`, `turnStartedAt`, `lastTool`, `preview`, `pendingPermissions[]` |
| **Message** | `seq` (монотонный), `id` (`m-xxxxxx`), `ts`, `from`, `to`, `kind` (`msg`/`reply`/`event`), `text`, `hops`, `replyTo?`, `wait?`, `failed?` |
| **AgentEvent** (чат агента) | `user` · `text` · `thought` · `tool` · `permission` · `system`, у каждого `seq`, `ts` |

Узлы графа: `you` (предопределён) и агенты. Системные сообщения имеют `from: "system"`.
Рёбра графа: постоянное `parent → агент` + эфемерные рёбра `from → to` по каждому `Message`.

### Статусы агента

```
starting ──► idle ◄──► working
   │           │          │
   │           └──► error (подключение/ход не удались; следующее сообщение пробует снова)
sleeping  — восстановлен из state.json, к nessy не подключён; просыпается при первом обращении
dead      — сессия nessy умерла (session_died); сообщения ему не доставляются
```

## Маршрутизация сообщений (`Orchestrator`)

Единственное место, где описаны правила (шапка `orchestrator.ts`):

1. `you → агент` (`msg`): доставка в очередь агента; по окончании хода ответ → `you` (`reply`, виден в inbox и ленте).
2. `агент A → агент B` (`msg`): доставка B; по окончании хода ответ автоматически → A (`reply`) и доставляется A промптом
   `[ответ агента … на твоё сообщение]`. Если A отправил с `wait=true`, ответ возвращается в его shell-вызов и
   **не** доставляется ему промптом.
3. Ход, вызванный `reply`, ответа не порождает — иначе пинг-понг.
4. Защиты (`post`/`send`):
   - `hops` = длина цепочки; для сообщения агента `hops = hops текущего обрабатываемого сообщения + 1`; `> maxHops` → `429 hop_limit`;
   - не более `rateLimitPerMinute` сообщений на пару `from>to` → `429 rate_limit`;
   - `wait` с взаимным (в т.ч. транзитивным) ожиданием → `409 deadlock`;
   - отправка себе → `400 self_send`; неизвестный получатель → `404 no_agent`.

```
you ──send──► Orchestrator.send ─► post ─► append(msg) ──► Agent.deliver ─► queue ─► pump ─► nessy /prompt
                                                                                           │
you ◄──inbox/feed/stream── append(reply) ◄── onTurnDone ◄── Agent.finishTurn ◄── turn_complete (SSE nessy)
```

### Очередь и ход (`Agent`)

- `deliver(msg)` кладёт сообщение в `queue`; `pump()` берёт следующее, когда нет текущего хода.
- Перед первым промптом сессии добавляется вводная (`preambleFor`): кто ты, id, как написать другим через
  `nessy-orch send --from <id> [--wait] <кому> "текст"`, список коллег. Флаг `introduced` хранится в state.
- События nessy нормализуются (`normalize`) и пишутся как `AgentEvent`: потоковый `text`/`thought` копится в блоке
  (`chunk` в шину, итог в файл при смене типа/конце хода), `tool` обновляется повторной записью **с тем же `seq`**
  (при чтении побеждает последняя запись с данным `seq`).
- Ход завершается по `turn_complete` (с проверкой `promptId`), по `session_died` или по ошибке отправки промпта.
- `permission_request` при автоподтверждении → голос `allow_once` (`pickPermissionOption`) + запись в события агента.

### Ожидание (`--wait`)

`send(..., wait:true)` регистрирует waiter по `message.id`; `append(reply)` с `replyTo` будит его. Таймаут
(`waitTimeoutSec`, по умолчанию 600) возвращает `timedOut:true`, агент продолжает работу. Ожидающие агенты учитываются в
графе `waitingOn` для детектора дедлоков.

### Inbox

`GET /inbox` отдаёт сообщения `to === you && kind === 'reply'` новее курсора; курсор хранится в `state.json`
(`inboxCursor`) и сдвигается при чтении без `peek`/`after`. `wait=N` — long-poll до N секунд.

## Пространства (`Space`)

- `managed`: `nessy serve --port <свободный из 4360+> --hostname 127.0.0.1 --no-web --workspace <path> --max-sessions N`.
  Вывод в `~/.nessy-orch/logs/space-<имя>.log`. Готовность — `GET /health`, таймаут `ORCH_HEALTH_TIMEOUT_MS` (60 с).
- `external`: уже запущенный демон по `url` (оркестратор его не запускает и не останавливает).
- Неожиданный выход процесса → `status: failed`, у агентов space вызывается `onSpaceDown` (отцепиться, ход — с ошибкой,
  статус `sleeping`). Следующее сообщение агенту вызывает `ensureReady()` и пересоздаёт serve.
- Один `nessy serve` привязан ровно к одному воркспейсу (`workspace_mismatch`) — поэтому space = воркспейс.

## Хранение (`~/.nessy-orch/`, переопределяется `NESSY_ORCH_HOME`)

| Файл | Содержимое |
|---|---|
| `state.json` | `spaces[]`, `agents[]` (вкл. `sessionId`, `lastEventId`, `queue`, `introduced`, `evSeq`), `msgSeq`, `inboxCursor`. Запись отложенная (200 мс), атомарная (tmp + rename) |
| `messages.jsonl` | лента сообщений, append-only; при старте читаются последние 5000 |
| `agents/<id>.jsonl` | события агента, append-only; удалённый агент → `<id>.jsonl.removed` |
| `logs/space-<имя>.log` | stdout/stderr процесса `nessy serve` |

Рестарт оркестратора: пространства и агенты восстанавливаются (агенты `sleeping`), лента и очереди сохраняются.
Ход, который был «в полёте» в момент остановки, **теряется** (ответ не придёт; см. [roadmap](roadmap.md)).

## Конфигурация (переменные окружения)

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `ORCH_PORT` | 4337 | порт API/UI |
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
shared/types.ts общие типы (сервер, CLI, UI)
src/core/       ядро (см. схему)
src/api/        HTTP/SSE сервер
src/cli/        команды CLI, форматирование, launchd
src/main.ts     точка входа демона
test/           fake-nessy.ts (имитация nessy serve), helpers, тесты
ui/             будущий UI (пока только README.md)
docs/           эта документация + contract/ (референс протокола nessy)
scripts/        postbuild.mjs (exec-биты)
```

## Качество кода

- `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `useUnknownInCatchVariables`.
- ESLint `strictTypeChecked`: запрещены `any`, `no-unsafe-*`, `@ts-ignore`, `no-floating-promises`, обязателен `import type`.
- Проверка: `npm run check` (typecheck + lint + test). Линтер на проекте **ещё ни разу не запускался** — ожидаются правки.
