# HTTP / SSE API оркестратора

База: `http://127.0.0.1:4337` (`ORCH_PORT`). Тела — JSON (`Content-Type: application/json`). Типы — `shared/types.ts`.

## Общие правила

- **Безопасность:** заголовок `Host` обязан быть `127.0.0.1:<порт>` / `localhost:<порт>` / `[::1]:<порт>`, иначе `403 bad_host`.
  Если есть `Origin` — только `http://127.0.0.1:<порт>` или `http://localhost:<порт>`, иначе `403 bad_origin`.
  Следствие для UI: он должен отдаваться с **того же origin** (статика с оркестратора). Dev-сервер на другом порту обязан
  проксировать запросы и убирать `Origin`, подменяя `Host`.
- **Ошибки:** статус ≥ 400, тело `{ "error": "<текст>", "code": "<код>" }`. Коды: `bad_request`, `bad_json`, `bad_path`,
  `bad_from`, `empty_text`, `self_send`, `space_required`, `no_space`, `space_exists`, `space_busy`, `no_agent`,
  `ambiguous_agent`, `name_taken`, `hop_limit` (429), `rate_limit` (429), `deadlock` (409), `nessy_error` (502),
  `too_large` (413, тело > 5 МБ), `not_found`, `internal` (500).
- **Ссылка на агента `:ref`** — id (`a-7f3k`) или уникальное имя (без учёта регистра). Особое значение `you` допустимо
  только как адресат `send`.
- Отдельного версионирования нет; изменения — обратно совместимые добавления полей.

## Служебное

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/health` | `{status:"ok"}` |
| GET | `/status` | `StatusResponse` (`version,pid,uptimeSec,rev,home,autoApprove,spaces,agents,working`) |
| GET | `/graph` | `GraphView` = `{rev, spaces[], agents[]}` |
| GET | любой путь, не начинающийся с API-сегмента | статика из `ORCH_UI_DIR` (`/` → `index.html`); нет SPA-fallback — для роутинга в UI используйте hash |

API-сегменты: `health status graph stream spaces agents messages inbox`.

## Пространства

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/spaces` | — | `SpaceView[]` |
| POST | `/spaces` | `{path (абсолютный, обязателен), name?, url?}` | `201 SpaceView`; существующий path возвращает имеющееся пространство |
| DELETE | `/spaces/:name?force=1` | — | `{ok:true}`; без `force` при наличии агентов → `409 space_busy` |

## Агенты

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/agents` | — | `AgentView[]` |
| POST | `/agents` | `SpawnRequest` | `201 SpawnResponse` |
| GET | `/agents/:ref` | — | `AgentView` |
| DELETE | `/agents/:ref` | — | `{ok:true}` (отмена хода, закрытие сессии, архив истории) |
| POST | `/agents/:ref/send` | `SendRequest` | `SendResponse` |
| POST | `/agents/:ref/cancel` | `{}` | `AgentView` (прервать ход, очистить очередь) |
| POST | `/agents/:ref/permission/:requestId` | `{approve:boolean}` (по умолчанию `true`) | `{ok:boolean}`, `404` если запрос не найден |
| GET | `/agents/:ref/history?limit=400` | — | `AgentEvent[]` по возрастанию `seq` (последняя запись с данным `seq` побеждает) |

### SpawnRequest

```jsonc
{ "space": "main",        // имя ИЛИ абсолютный путь (неизвестный путь создаёт space); можно опустить, если space один
  "name": "reviewer",     // опционально, уникально; иначе = id
  "prompt": "задача",     // опционально: если задан — отправляется сразу
  "from": "you",          // отправитель стартового сообщения (id агента, если агент спавнит агента)
  "parent": "you",        // родитель в графе; по умолчанию = from
  "wait": true,           // дождаться ответа на prompt
  "waitTimeoutSec": 600 }
```

`SpawnResponse` = `{agent, message, reply?, timedOut?}` (`message` — стартовое сообщение; без `prompt` его нет).

### SendRequest / SendResponse

```jsonc
{ "text": "…", "from": "you", "wait": false, "waitTimeoutSec": 600 }
// → { "message": Message, "reply"?: Message, "timedOut"?: true }
```

Без `wait` ответ приходит позже: в `/inbox` (если адресат — you), в ленте и в потоках. `from` — id агента, от чьего имени
пишем (так делают сами агенты).

## Сообщения

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/messages?agent=&since=&limit=200` | `Message[]` по возрастанию `seq`; `agent` — все сообщения, где он отправитель или получатель; `since` — только `seq > since` |
| GET | `/inbox?wait=СЕК&peek=1&after=SEQ` | `InboxResponse` = `{messages, cursor}`; новые `reply` для `you`. Без `peek`/`after` курсор сдвигается. `wait` — long-poll |

## Потоки (SSE)

Заголовки ответа: `Content-Type: text/event-stream`. Каждые 15 с — комментарий `: hb`. **Кадры без поля `event:`** —
только `data: <json>` (в `/stream` ещё `id: <rev>`). Для браузера подходит `EventSource` (тот же origin).

### `GET /stream` — граф и общая лента

Первый кадр — снапшот, дальше изменения (`StreamEvent`):

```jsonc
{"t":"snapshot","rev":42,"spaces":[…],"agents":[…],"messages":[…последние 300…]}
{"t":"message","rev":43,"message":{…}}
{"t":"agent","rev":44,"agent":{…}}           // upsert узла (статус, очередь, превью, права…)
{"t":"agent_removed","rev":45,"id":"a-7f3k"}
{"t":"space","rev":46,"space":{…}}           // upsert
{"t":"space_removed","rev":47,"name":"main"}
```

Правила клиента: при **каждом (пере)подключении** приходит новый `snapshot` — состояние заменяется целиком. События чата
агентов и чанки в `/stream` **не** идут.

### `GET /agents/:ref/stream` — чат агента

Сначала реплей до 400 последних `AgentEvent`, затем `{"t":"agent",…}` и `{"t":"replay_done"}`, дальше живые кадры
(`AgentStreamEvent`):

```jsonc
{"t":"event","event":{"seq":12,"ts":…,"kind":"user","from":"you","msgId":"m-…","text":"…"}}
{"t":"chunk","chunk":{"seq":13,"ts":…,"kind":"text","delta":"при","len":3}}   // дельта живого блока text|thought
{"t":"event","event":{"seq":13,"ts":…,"kind":"text","text":"привет"}}          // итог блока (тот же seq)
{"t":"event","event":{"seq":14,"kind":"tool","toolId":"…","name":"run_shell_command","title":"…","input":{…},"status":"in_progress"}}
{"t":"event","event":{"seq":14,"kind":"tool",…,"status":"completed","output":"…"}}   // обновление — тот же seq
{"t":"event","event":{"seq":15,"kind":"permission","requestId":"…","title":"…","resolved":false}}
{"t":"agent","agent":{…}}
```

**Правило слияния:** событие с уже виденным `seq` **заменяет** прежнее. `chunk` дописывает `delta` к живому блоку с этим
`seq` (создать, если нет); последующий `event` с тем же `seq` фиксирует итоговый текст. При переподключении реплей
приходит заново — буфер очищать.

## Примеры (curl)

```sh
curl -s localhost:4337/status
curl -s -XPOST localhost:4337/spaces -d '{"path":"/Users/me/Projects/shippy"}'
curl -s -XPOST localhost:4337/agents -d '{"space":"shippy","name":"rev","prompt":"что в README?","wait":true}'
curl -s -XPOST localhost:4337/agents/rev/send -d '{"text":"а в CHANGELOG?"}'
curl -s 'localhost:4337/inbox?wait=60'
curl -sN localhost:4337/stream
```
