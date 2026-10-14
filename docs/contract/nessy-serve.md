# Контракт `nessy serve`

| | |
|---|---|
| **Дата** | 2026-10-14 |
| **Версия nessy** | `0.13.16` (CLI), пакет `@nestor/nessy-cli` `0.13.16-beta.0` |
| **Источник** | ветка `master` репозитория `nestor/nessy-cli` (`gitlab.tcsbank.ru/nestor/nessy-cli`); документация и исходники — каталог `docs/contract/nessy/` |
| **Статус** | рабочий черновик по двум отчётам (code-study + experiments) |

Документ фиксирует фактическое поведение HTTP/SSE-протокола демона `nessy serve` (режим `http-bridge`), сверенное по исходникам `nessy-cli/` и живым экспериментам. Пометки: `[код]` — подтверждено исходником с `файл:строка`; `[опыт]` — наблюдалось в живом эксперименте (приведена команда); `[догадка]` — вывод без прямой ссылки. Исходные отчёты сохранены в `docs/contract/nessy-serve-sources/`.

## Оглавление

1. [ОБЩЕЕ](#1-общее)
2. [ЖИЗНЕННЫЙ ЦИКЛ СЕССИИ](#2-жизненный-цикл-сессии)
3. [ЛИМИТЫ И ОШИБКИ](#3-лимиты-и-ошибки)
4. [СОБЫТИЯ SSE](#4-события-sse)
5. [ДОСТАВКА СООБЩЕНИЙ](#5-доставка-сообщений)
6. [ОКРУЖЕНИЕ И БЕЗОПАСНОСТЬ](#6-окружение-и-безопасность)

---

## 1. ОБЩЕЕ

### Версия и модель

- Пакет `@nestor/nessy-cli` версии `0.13.16-beta.0`, репозиторий `gitlab.tcsbank.ru/nestor/nessy-cli` `[код]` `nessy-cli/package.json:2-3,38-41`. В рантайме отдаёт `nessyCodeVersion: "0.13.16"` `[опыт]` `GET /capabilities`.
- Модель. По исходникам дефолтная модель — `qwen3-coder-plus` (контекст 1M), код форка `QwenCode` `[код]` `packages/core/src/providers/presets/alibaba-coding-plan.ts:44-45`, `packages/core/src/config/config.ts:611`. **В живом эксперименте** дефолтная модель сессии оказалась `tgpt/deepseek-v4-flash-0731(dp-auth)` (DeepSeek V4 Flash), а Qwen 3.5 397B доступен в списке моделей как опция `tgpt/qwen35-397b-a17b-fp8(openai)` `[опыт]` (exp 3, поле `state.models`). Оба факта фиксируем без выбора одной версии: вероятная причина расхождения — жёсткий дефолт в коде (`qwen3-coder-plus`) против выбора модели-сервисом/конфигом окружения на стороне `dp-auth`-провайдера (`deepseek-v4-flash`), т.е. что реально подставлено в сессию зависит от окружения, а не от исходника. Подробнее — «Не проверено / риски».
- HTTP-слой — Express в `packages/cli/src/serve/server.ts` (~6040 строк); ACP-мост — `packages/acp-bridge/src/bridge.ts` (`createAcpSessionBridge`); мост общается с ACP-ребёнком `nessy --acp` через канал `[код]` `server.ts:1934`, `acp-session-bridge.ts:11-13`, `packages/acp-bridge/src/spawnChannel.ts:131-140`.
- Архитектура: один демон = один workspace, один ACP-ребёнок (`--http-bridge`), N сессий мультиплексируются через `newSession()` `[код]` `packages/cli/src/commands/serve.ts:209-214`, `packages/acp-bridge/src/bridge.ts:1008-1014`.

### Запуск и флаги

Запуск (из experiments, демон с токеном и bound-воркспейсом, без веб-UI):
```
nessy serve --port 4395 --hostname 127.0.0.1 --token lab-token --workspace /private/tmp/nessy-lab-4200 --no-web
```
Вывод старта `[опыт]`:
```
nessy serve: --token is visible in the process command line; prefer the NESSY_SERVER_TOKEN env var...
nessy serve: daemon log → ~/.nessy/debug/daemon/serve-4554-....log
nessy serve: session reaper started (interval 60000ms, idle threshold 1800000ms)
nessy serve listening on http://127.0.0.1:4395 (mode=http-bridge, workspace=/private/tmp/nessy-lab-4200)
nessy serve: /acp WebSocket transport enabled on /acp
```

Флаги (по `packages/cli/src/commands/serve.ts`) `[код]`:

| Флаг | Дефолт | Смысл | Строка |
|---|---|---|---|
| `--port` | `4170` (0 = ephemeral) | TCP-порт | `serve.ts:118-123` |
| `--hostname` | `127.0.0.1` | интерфейс; не-loopback ⇒ обязателен token | `serve.ts:125-129` |
| `--token` | — | Bearer; fallback `NESSY_SERVER_TOKEN` | `serve.ts:131-134` |
| `--max-sessions` | `20` | лимит живых сессий (0 = безлимит) | `serve.ts:138-143` |
| `--max-pending-prompts-per-session` | `5` | очередь промптов на сессию | `serve.ts:147-152` |
| `--workspace` | `process.cwd()` | привязка workspace | `serve.ts:154-160` |
| `--max-connections` | `256` | TCP-лимит listener | `serve.ts:162-167` |
| `--require-auth` | `false` | токен обязателен даже на loopback | `serve.ts:169-177` |
| `--enable-session-shell` | `false` | включить `POST /session/:id/shell` | `serve.ts:179-182` |
| `--web/--no-web` | `true` | Web Shell UI | `serve.ts:188-191` |
| `--event-ring-size` | `8000` | глубина SSE ring | `serve.ts:199-208` |
| `--http-bridge` | `true` | один `nessy --acp` ребёнок | `serve.ts:209-214` |
| `--mcp-client-budget`, `--mcp-budget-mode` | —/`warn` | бюджет MCP | `serve.ts:215-225` |
| `--allow-origin` | — | CORS allowlist | `serve.ts:226-228` |
| `--prompt-deadline-ms` | — | wallclock-потолок `POST /prompt` | `serve.ts:233-236` |
| `--writer-idle-timeout-ms` | — | idle-таймаут SSE-клиента | `serve.ts:237-240` |
| `--channel-idle-timeout-ms` | `0` | живёт ли ACP-ребёнок после последней сессии | `serve.ts:241-243` |
| `--session-idle-timeout-ms` | `1800000` (30 мин) | reap отсоединённых | `serve.ts:247-249` |
| `--permission-response-timeout-ms` | `300000` (5 мин) | таймаут permission | `serve.ts:250-253` |
| `--rate-limit*` | — | тарифы prompt/mutation/read 10/30/120 | `serve.ts:254-273` |

Переменные окружения демона `[код]`: `NESSY_SERVER_TOKEN` (замена токена, `run-nessy-serve.ts:82,470-473`), `NESSY_SERVE_PROMPT_DEADLINE_MS`, `NESSY_SERVE_WRITER_IDLE_TIMEOUT_MS` (`run-nessy-serve.ts:56-59`), `NESSY_SERVE_RATE_LIMIT[_PROMPT|_MUTATION|_READ|_WINDOW_MS]` (`serve.ts:343-356`), `NESSY_SERVE_ACP_HTTP=0` (выкл. ACP-транспорт, `acp-http/index.ts:109`), `NESSY_SERVE_NO_MCP_POOL`, `NESSY_SERVE_MCP_CLIENT_BUDGET/MODE` (`run-nessy-serve.ts:768,780-781`), `NESSY_CLI_ENTRY` (путь к entry для спавна, `spawnChannel.ts:117`), `NESSY_CLI_NO_RELAUNCH='true'` (ставится ребёнку, `spawnChannel.ts:126`).

### Авторизация

- Если задан `--token`/`NESSY_SERVER_TOKEN` — Bearer (SHA256 pre-hash + `timingSafeEqual`, `auth.ts:272-332`); иначе на loopback гейт открыт `[код]` `run-nessy-serve.ts:1236-1238`. Не-loopback без токена — отказ на старте `[код]` `run-nessy-serve.ts:523-529`.
- `X-Nessy-Client-Id` (валидация `^[A-Za-z0-9._:-]{1,128}$`, `server.ts:5293-5311`) и `createMutationGate({strict})` (`auth.ts:338-420`).
- Без токена: `GET /health` → `200 {"status":"ok"}` `[опыт]`; `GET /` → `401 {"error":"Unauthorized"}` `[опыт]`.

### Полная таблица HTTP-эндпоинтов

Легенда: 4xx/5xx в скобках — основные. SSE = text/event-stream. `mutate()` = гейт мутаций. **Идемпотентность**: явно отмечена, где подтверждена кодом/опытом; где не указана — не подтверждена.

#### Сервис / health / workspace-статусы
| Метод | Путь | Тело/параметры | Ответ | Идемпот. | Строка |
|---|---|---|---|---|---|
| GET | `/health` | `?deep=1` | `200 {status:'ok'}` (deep: +sessions/pendingPermissions) / `503 {status:'degraded'}` | да | `server.ts:1833,1959` |
| GET | `/demo` | — | HTML демо API | да | `server.ts:1834,1960` |
| GET | `/daemon/status` | `?detail=summary\|full` | статус демона | да | `server.ts:2004` |
| GET | `/capabilities` | — | `{v, protocolVersions, nessyCodeVersion, mode, features, workspaceCwd, transports:['rest'], policy, limits, supportedLanguages}` | да | `server.ts:2045` |
| GET | `/workspace/mcp` | — | статус MCP-серверов | да | `server.ts:2076` |
| GET | `/workspace/mcp/:server/tools` | — | инструменты MCP-сервера | да | `server.ts:2085` |
| GET | `/workspace/skills` | — | статус скиллов | да | `server.ts:2108` |
| GET | `/workspace/tools` | — | инструменты workspace | да | `server.ts:2117` |
| GET | `/workspace/providers` | — | провайдеры | да | `server.ts:2125` |
| GET | `/workspace/env` | — | снимок env (в т.ч. SANDBOX/SEATBELT_PROFILE) | да | `server.ts:2159`, `env-snapshot.ts:167-183` |
| GET | `/workspace/preflight` | — | пре-проверка | да | `server.ts:2168` |
| GET | `/workspace/hooks` | — | конфиг хуков | да | `server.ts:2178` |
| GET | `/workspace/extensions` | — | установленные расширения | да | `server.ts:2188` |
| GET | `/workspace/extensions/operations/:operationId` | — | операция (404 если нет) | да | `server.ts:2197` |
| POST | `/workspace/extensions/install` | `{source,ref?,autoUpdate?,allowPreRelease?,registry?,consent:true}` | `{status:'installed',...}` | нет | `server.ts:2226` |
| POST | `/workspace/extensions/check-updates` | — | `{states}` | нет | `server.ts:2356` |
| POST | `/workspace/extensions/refresh` | — | результат | нет | `server.ts:2400` |
| POST | `/workspace/extensions/:name/enable\|disable\|update` | `{scope?}` | `{status,...}` | нет | `server.ts:2434,2480,2526` |
| DELETE | `/workspace/extensions/:name` | — | `{status:'uninstalled'}` | да | `server.ts:2603` |
| POST | `/workspace/mcp/:server/restart` | `?entryIndex=` | `{restarted,...}` (мягкий отказ 200) | нет | `server.ts:4109` |
| POST | `/workspace/mcp/:server/enable\|disable\|authenticate\|clear-auth` | — | результат | нет | `server.ts:4183` |
| POST | `/workspace/mcp/servers` | `{name,config}` (+client-id) | добавление runtime MCP | нет | `server.ts:4221` |
| DELETE | `/workspace/mcp/servers/:name` | (+client-id) | удаление runtime MCP | **да** (идемпотентно) | `server.ts:4269` |
| POST | `/workspace/init` | `{force?}` | init NESSY.md (409 без force) | нет | `server.ts:4297` |
| POST | `/workspace/reload` | — | перезагрузка workspace | нет | `server.ts:4324` |
| POST | `/workspace/tools/:name/enable` | `{enabled}` | toggle инструмента | нет | `server.ts:4340` |

#### Файлы / память / агенты / настройки / A2UI
| Метод | Путь | Смысл | Идемпот. | Строка |
|---|---|---|---|---|
| GET | `/file` | чтение файла | да | `routes/workspace-file-read.ts:519` |
| GET | `/file/bytes` | чтение байтов | да | `workspace-file-read.ts:520` |
| GET | `/stat` | stat | да | `workspace-file-read.ts:521` |
| GET | `/list` | список каталога | да | `workspace-file-read.ts:522` |
| GET | `/glob` | glob | да | `workspace-file-read.ts:523` |
| POST | `/file/write` | запись файла | нет | `routes/workspace-file-write.ts:286` |
| POST | `/file/edit` | edit | нет | `workspace-file-write.ts:289` |
| GET/POST | `/workspace/memory` | чтение/запись памяти | GET да / POST нет | `workspace-memory.ts:86,112` |
| GET | `/workspace/agents` | список агентов | да | `workspace-agents.ts:109` |
| POST | `/workspace/agents` | создать агента | нет | `workspace-agents.ts:157` |
| POST | `/workspace/agents/generate` | генерация | нет | `workspace-agents.ts:290` |
| GET | `/workspace/agents/:agentType` | агент | да | `workspace-agents.ts:333` |
| POST | `/workspace/agents/:agentType` | обновить | нет | `workspace-agents.ts:360` |
| DELETE | `/workspace/agents/:agentType` | удалить | да | `workspace-agents.ts:509` |
| GET | `/workspace/settings` | настройки | да | `routes/workspace-settings.ts:209` |
| POST | `/workspace/settings` | записать настройку | нет | `workspace-settings.ts:226` |
| POST | `/session/:id/a2ui-action` | A2UI action | нет | `routes/a2ui-action.ts:221` |

#### Auth / device-flow
| Метод | Путь | Смысл | Строка |
|---|---|---|---|
| POST | `/workspace/auth/device-flow` | старт device-flow (200 attached / 201 fresh; 409 too many, 502 upstream) | `server.ts:2846` |
| GET | `/workspace/auth/device-flow/:id` | статус (секреты только инициатору) | `server.ts:2766` |
| DELETE | `/workspace/auth/device-flow/:id` | отмена (204, **идемпотентно**) | `server.ts:2799` |
| GET | `/workspace/auth/status` | pending flows + providers | `server.ts:2826` |
| GET | `/workspace/auth/providers` | каталог провайдеров | `server.ts:2842` |
| POST | `/workspace/auth/provider` | установка провайдера (501 если не реализовано) | `server.ts:2846` |

#### Сессии
| Метод | Путь | Смысл | Идемпот. | Строка |
|---|---|---|---|---|
| POST | `/session` | создать/присоединиться (см. §2) | нет | `server.ts:2902` |
| POST | `/session/:id/load` | restore (replay) | да (на повтор — `attached:true`) | `server.ts:3116` |
| POST | `/session/:id/resume` | restore (без replay) | да | `server.ts:3117` |
| POST | `/session/:id/branch` | ответвить (201; 409 при активном промпте) | нет | `server.ts:3119` |
| POST | `/session/:id/fork` | форк-агент (202) | нет | `server.ts:3162` |
| GET | `/session/:id/context` | статус контекста | да | `server.ts:3191` |
| GET | `/session/:id/context-usage` | токены/контекст | да | `server.ts:3204` |
| GET | `/session/:id/stats` | метрики | да | `server.ts:3221` |
| GET | `/session/:id/supported-commands` | команды | да | `server.ts:3234` |
| GET | `/session/:id/tasks` | задачи | да | `server.ts:3249` |
| GET | `/session/:id/lsp` | LSP-статус | да | `server.ts:3262` |
| GET | `/session/:id/hooks` | хуки сессии | да | `server.ts:3276` |
| POST | `/session/:id/tasks/:taskId/cancel` | отмена задачи | нет | `server.ts:3286` |
| POST | `/session/:id/goal/clear` | сброс цели | нет | `server.ts:3319` |
| POST | `/session/:id/prompt` | промпт (202 `{promptId,lastEventId}`; 503 queue full) | нет | `server.ts:3341` |
| POST | `/session/:id/heartbeat` | heartbeat | да | `server.ts:3479` |
| POST | `/session/:id/detach` | отсоединить клиента (204) | да | `server.ts:3498` |
| POST | `/session/:id/cancel` | отмена хода (204) | да | `server.ts:3514` |
| DELETE | `/session/:id` | закрыть сессию (204) | да | `server.ts:3540` |
| POST | `/sessions/delete` | batch-удаление `{sessionIds[]<=100}` | да | `server.ts:3558` |
| PATCH | `/session/:id/metadata` | `{displayName}` | да | `server.ts:3639` |
| GET | `/workspace/:id/sessions` | список живых+сохранённых (cursor/size) | да | `server.ts:3672` |
| POST | `/session/:id/model` | `{modelId}` | нет | `server.ts:3729` |
| POST | `/session/:id/recap` | резюме | нет | `server.ts:3760` |
| POST | `/session/:id/btw` | `{question}` | нет | `server.ts:3790` |
| POST | `/session/:id/mid-turn-message` | `{message<=16KiB}` | нет | `server.ts:3854` |
| POST | `/session/:id/shell` | `{command}` (только с token+client-id) | нет | `server.ts:3896` |
| GET | `/session/:id/rewind/snapshots` | снимки rewind | да | `server.ts:3961` |
| POST | `/session/:id/rewind` | `{promptId,rewindFiles?}` | нет | `server.ts:3979` |
| POST | `/session/:id/approval-mode` | `{mode,persist?}` | нет | `server.ts:4011` |
| POST | `/session/:id/language` | `{language,syncOutputLanguage?}` | нет | `server.ts:4060` |
| POST | `/session/:id/permission/:requestId` | голос по permission | нет | `server.ts:4408` |
| POST | `/permission/:requestId` | голос (глобально) | нет | `server.ts:4448` |
| POST | `/elicitation/:requestId` | ответ elicitation | нет | `server.ts:4481` |
| POST | `/session/:id/elicitation/:requestId` | ответ elicitation (сессия) | нет | `server.ts:4512` |
| GET | `/session/:id/events` | SSE-поток (см. §4) | да (reconnect по `Last-Event-ID`) | `server.ts:4553` |

#### Другие точки
- `POST /acp`, `GET /acp`, `DELETE /acp` + WebSocket — официальный ACP Streamable HTTP transport (RFD #721), отдельный транспорт, смонтирован после REST `[код]` `server.ts:4978`, `acp-http/index.ts:112,140,282,401`. Отключается `NESSY_SERVE_ACP_HTTP=0`.
- Web Shell SPA static + fallback `[код]` `server.ts:1934-1957,4978-...` (`mountWebShellSpaFallback`).

---

## 2. ЖИЗНЕННЫЙ ЦИКЛ СЕССИИ

### Создание — `POST /session`

Из тела реально читаются только: `cwd` (fallback на `boundWorkspace`; обязана быть абсолютной, ≤4096; иначе 400), `modelServiceId`, `sessionScope` (`single`|`thread`, иначе 400 `invalid_session_scope`), плюс заголовок `X-Nessy-Client-Id` `[код]` `server.ts:2902-3028`. Далее `bridge.spawnOrAttach({workspaceCwd, modelServiceId, clientId, sessionScope})` `[код]` `bridge.ts:990-1162`, поля типа `BridgeSpawnRequest` `[код]` `bridgeTypes.ts:54-70`.

**НЕ читаются из тела при создании:** `env`, системные инструкции, роль, модель, режим разрешений. Модель и approval mode задаются отдельно (`POST /session/:id/model`, `/approval-mode`). «env на сессию» в коде не найден.

Семантика `sessionScope` `[код]` `bridge.ts:1088-1157`: `single` → attach к `defaultEntry`, `thread` → всегда новая сессия. Ответ: `{sessionId, workspaceCwd, attached, clientId?}` `[код]` `bridgeTypes.ts:72-84`. Если клиент отключился до 200 — сессия отзывается (`killSession`/`detachClient`) `[код]` `server.ts:3030-3083`.

Пример `[опыт]`:
```
POST /session  {"cwd":"/private/tmp/nessy-lab-4200"}
→ {"sessionId":"3bcd3144-...","workspaceCwd":"/private/tmp/nessy-lab-4200","attached":false,
   "clientId":"client_42824520-...","createdAt":"2026-10-14T09:20:32.917Z"}
```

### Закрытие

- `DELETE /session/:id` → `bridge.closeSession` → `byId.delete`, `forgetSession` (отмена pending permission), `events.close()`, ACP `nessy/control/session/close`, `cancel()`, публикация `session_closed`, idle-таймер канала. JSONL-транскрипт **сохраняется** `[код]` `bridge.ts:2444-2537`. В опыте `DELETE` вернул `204 No Content`, файл `.jsonl` при этом **не удаляется** и переживает рестарт `[опыт]` (exp 3, 14).
- `POST /sessions/delete` → `closeSession` по каждому + `SessionService.removeSessions` (удаляет JSONL-файлы); ответ `{removed, notFound, errors}` `[код]` `server.ts:3558-3637`.
- `POST /session/:id/detach` → `detachClient` (декремент attachCount, отписка клиента); если это был последний клиент без подписчиков и промпта — `closeSessionImpl(reason='last_client_detached')`, файл на диске сохраняется `[код]` `bridge.ts:5008-5054`. Явного «detach»-роута в опыте не наблюдалось; освобождение простаивающей сессии — по таймауту reaper'а (`--session-idle-timeout-ms`, 30 мин) `[опыт]` exp 8.

### Хранение на диске

Путь: `~/.nessy/tmp/<projectHash>/chats/<sessionId>.jsonl` `[код]` `packages/core/src/services/sessionService.ts:234-244`, `storage.ts:313-320`. `projectHash = getProjectHash(cwd)` — путь зависит от cwd `[код]` `sessionService.ts:239-240`. Формат — JSONL, каждая строка `ChatRecord` (`uuid, parentUuid, sessionId, timestamp, type(user|assistant|tool_result|system), subtype, cwd, version, message, usageMetadata, model, toolCallResult, ...`) `[код]` `chatRecordingService.ts:225-305`. Пишется ACP-ребёнком (`ChatRecordingService.appendRecord`) на каждом ходе, **не** демоном `[код]` `chatRecordingService.ts:737-761`; в `bridge.ts` нет импорта `SessionService`.

В опыте `[опыт]` (exp 14): история в `~/.nessy/projects/-private-tmp-nessy-lab-4200/chats/3bcd3144-....jsonl` (63 строки, 57053 байта); формат JSONL `{uuid, parentUuid, sessionId, timestamp, type(user|system|assistant), cwd, version, message|model, ...}`. Воркспейс `/private/tmp/nessy-lab-4200` оставался пустым.

### load / resume / branch / fork

- `load` → ACP `loadSession`, возвращает `state` + `compactedReplay` + `liveJournal` + `lastEventId` `[код]` `bridge.ts:2323-2332,2178-2191`. `resume` → `resumeSession`, только `lastEventId` (без replay) `[код]` `bridge.ts:2334-2341`.
- `branch` → ждёт окончания промпта, ACP `nessy/control/session/branch`, затем `load` новой сессии; `BranchWhilePromptActiveError` 409 если промпт активен `[код]` `bridge.ts:3442-3523`.
- `fork` → ACP `nessy/control/session/forkAgent` c `{directive}`; `SessionBusyError` 409 если сессия занята; возвращает 202 `{sessionId, description, launched}` `[код]` `bridge.ts:4490-4549`.
- Для несуществующей/удалённой сессии `load`/`resume` → `SessionNotFoundError` 404 `[код]` `bridgeErrors.ts` / `server.ts:5823-5827`.

Опыт `[опыт]` (exp 3, 13): `POST /session/:id/load` после рестарта → `200`, `attached:false`, **2.14с**, тело **36953 байта**, `lastEventId:50`, `liveJournal_len:50`, `state` (`modes.currentModeId="auto-edit"`, `models`, `configOptions`). На уже-живой сессии `load` возвращает `attached:true` и `liveJournal_len:1` (только хвост) — полного replay нет.

### contextId / loadedFromHistory

**В коде не найдено** — ни в `bridgeTypes.ts`, ни в `bridge.ts`, ни в serve (grep `contextId|loadedFromHistory` по `packages` → 0 совпадений). Это термины ACP-SDK; демон их не использует. `state` из `session/load`/`resume` прокидывается как есть `[код]` `bridgeTypes.ts:95-111`. Если внешний оркестратор ждёт этих полей в ответах — их нет.

### Компакция при /load большой сессии

`TurnBoundaryCompactionEngine` подключается в EventBus `[код]` `bridge.ts:1921`, `compactionEngine.ts`. На `turn_complete`/`turn_error` сворачивает события хода в компактные (O(turns), типично 25–30x) `[код]` `compactionEngine.ts:34-67`. `load` возвращает `compactedReplay` + `liveJournal` `[код]` `bridge.ts:2178-2191`. Отдельного `/compact`/`summarize` в bridge нет; `recap` (`POST /session/:id/recap`) даёт одно предложение «где я остановился» `[код]` `server.ts:3760`.

### Replay событиями SSE

История **проигрывается событиями SSE**. При подписке `GET /session/:id/events` (initial attach): синтетический `session_snapshot` → события из кольца → `replay_complete` `[код]` `bridge.ts:2640-2677`. При reconnect с `Last-Event-ID`: события кольца после id → `replay_complete` → `session_snapshot`.

Событие `replay_complete` `[код]` `eventBus.ts:455-470`: `{v, type:'replay_complete', data:{lastReplayedEventId, lastEventId(alias), replayedCount}}`, без `id:` (не жжёт слот). Отличие повторённого от нового — по `event.id`: повторённые идут с реальными `id:` из кольца, синтетические терминальные (`replay_complete`, `client_evicted`, `state_resync_required`, `stream_error`, `slow_client_warning`) — без `id` `[код]` `server.ts:5577-5600`.

Опыт `[опыт]` (exp 4): на холодном restore подписка с `Last-Event-ID:0`:
```
event: replay_complete
data: {"v":1,"type":"replay_complete","data":{"lastReplayedEventId":56,"lastEventId":56,"replayedCount":56}}
```
История проигрывается как `session_update` с id 1..56, затем `replay_complete`, затем новые события идут подряд (id монотонно растут). Отличить повтор от нового: replay-фреймы идут до `replay_complete`, новые — после него. Нюанс: если подписка открыта ДО `load` (сессия ещё не в кольце), replay не прилетает — подписываться после `load` с `Last-Event-ID:0`.

### load + prompt сразу

Явной очереди «load→prompt» нет. Промпты сериализуются FIFO через `entry.promptQueue` `[код]` `bridge.ts:820`. `RestoreInProgressError` (409) срабатывает только при **двух одновременно** restore одной сессии `[код]` `bridge.ts:2220-2229`. Если промпт ушёл до завершения restore, entry ещё не в `byId` ⇒ вероятен `SessionNotFoundError` 404 `[догадка]` (по структуре `sendPrompt` → lookup `byId`, `bridge.ts:2683+`). В опыте `POST /load` + сразу `POST /prompt` на живой сессии оба вернули `200` (промпт принят, `promptId`, `lastEventId:36`) `[опыт]` exp 7; холодную гонку не провоцировали.

### Список сессий

`GET /workspace/:id/sessions` (id = URL-encoded absolute cwd) — живые (`bridge.listWorkspaceSessions`) + сохранённые (`SessionService.listSessions`), сортировка по updatedAt, пагинация `?cursor=&size=` (size ≤100, DEFAULT 20), `nextCursor`; 400 `workspace_mismatch` если id ≠ boundWorkspace `[код]` `server.ts:3672-3727`, `listWorkspaceSessionsForResponse` `server.ts:205-280`.

---

## 3. ЛИМИТЫ И ОШИБКИ

### --max-sessions

Проверка `byId.size + inFlightSpawns.size + inFlightRestores.size >= maxSessions` → `SessionLimitExceededError` в трёх местах: `restoreSession` `bridge.ts:2274`, `spawnOrAttach` `bridge.ts:1166-1170`, `branchSession` `bridge.ts:3434-3463`. HTTP: **503** + `Retry-After: 5` + `{error, code:'session_limit_exceeded', limit}` `[код]` `server.ts:5885-5895`. Default 20 `[код]` `serve.ts:138-143`, `bridge.ts:778`.

**Учитываются:** только живые в `byId` + идущие спавн/restore. Закрытые/удалённые не считаются (`byId.delete`). Отсоединённые (`detach`), но с активным промптом/SSE-подписчиками — остаются в `byId` и **считаются** `[код]` `bridge.ts:5008-5054`. Простаивающие дольше `--session-idle-timeout-ms` (30 мин) убиваются reaper'ом `[код]` `bridge.ts:915-946`.

Опыт `[опыт]` (exp 8, демон `--max-sessions 1`): 2-я `thread`-сессия при занятом слоте → `503 {"error":"Session limit reached (1)","code":"session_limit_exceeded","limit":1}` + `Retry-After:5`; attach (single-scope) при полном слоте → `200 attached:true` (attach НЕ считается в лимит); `thread` при занятом single-слоте → 503; `DELETE` освобождает слот.

### Ресурсы на сессию

Один ACP-ребёнок на демон (`--http-bridge`), внутри — ACP-процесс; MCP-серверы спавнятся отдельно. На каждую сессию в `byId: Map<sessionId, SessionEntry>` `[код]` `bridge.ts:976`. `SessionEntry` держит: `events` (EventBus: кольцо до `--event-ring-size`=8000 + подписчики), `promptQueue` (Promise-цепь), `pendingPromptCount`, `midTurnMessageQueue` (≤20), `modelChangeQueue`, `approvalModeQueue`, `clientIds`, `clientLastSeenAt`, `pendingPermissionIds`, `attachCount`, кэши модели/approval-mode и др. `[код]` `bridge.ts:175-352`.

### Прочие лимиты

- Параллельные промпты на сессию: **1 активный**; очередь ≤ `--max-pending-prompts-per-session` (default **5**) → иначе `PromptQueueFullError` 503 `{code:'prompt_queue_full'}` `[код]` `bridge.ts:2848-2855`, `serve.ts:147-152`, `server.ts:5897-5906`.
- Mid-turn очередь: ≤ **20** (`MAX_MID_TURN_QUEUE_DEPTH`) `[код]` `bridge.ts:774,4590`; `{accepted:false}` когда сессия простаивает или очередь полна.
- SSE: подписчиков на сессию ≤ **64** (`DEFAULT_MAX_SUBSCRIBERS`) → `SubscriberLimitExceededError` **429** `[код]` `eventBus.ts:96-97`, `server.ts:4578-4595`; backlog на подписчика `maxQueued` default **256** (range [16,2048]) `[код]` `eventBus.ts:78-85`, `server.ts:5411-5440`.
- Ring событий: `DEFAULT_RING_SIZE` **8000**, `MAX_EVENT_RING_SIZE` 1_000_000 `[код]` `eventBus.ts:89-92`, `bridge.ts:791`.
- Rate limit (опционально): prompt 10/мин, mutation 30/мин, read 120/мин → **429** `{code:'rate_limit_exceeded'}` `[код]` `rate-limit.ts:170-182`. Exempt: health/demo/heartbeat/SSE/acp.
- Размер тела JSON: `express.json({limit:'10mb'})` → **413** при превышении `[код]` `server.ts:1940`, `sendJsonBodyParserError` `server.ts:5065-5080`.

### Каталог кодов ошибок (HTTP)

- `400 invalid_request` / `invalid_session_scope` / `invalid_client_id` / `invalid_server_name` / `invalid_tool_name` / `invalid_max_queued` / `invalid_cursor` / `invalid_metadata` / `invalid_language` / `invalid_approval_mode` / `invalid_option_id` / `invalid_deadline_ms` / `invalid_detail` / `missing_directive` / `missing_prompt_id` / `missing_client_id` / `workspace_mismatch` / `workspace_init_path_escape` / `workspace_init_symlink` / `workspace_init_race` / `invalid_rewind_target` / `invalid_enabled_flag` / `invalid_force_flag` / `invalid_persist_flag` / `invalid_sync_flag` / `invalid_entry_index` / `invalid_scope` / `invalid_description` / `unsupported_provider` / `unsupported_protocol` / `invalid_base_url` `[код]` server.ts (мн. места).
- `403 permission_forbidden` / `trust_gate` / `session_shell_disabled` / `client_id_required` `[код]` `server.ts:5398-5420,5855-5878`.
- `404 SessionNotFoundError` / `mcp_server_not_found` / `extension_operation_not_found` / `device_flow_not_found` / «No pending permission request» / «No pending elicitation request» `[код]` `server.ts:5816-5827`.
- `409 workspace_init_conflict` / `branch_while_prompt_active` / `restore_in_progress` / `session_busy` / `mcp_budget_would_exceed` / `too_many_active_flows` `[код]` `server.ts:5709-5714,5763-5771,5908-5930`.
- `429 subscriber_limit_exceeded` / `rate_limit_exceeded` `[код]` `server.ts:4592`, `rate-limit.ts:170`.
- `500` generic (ошибки bridge) + `cancel_sentinel_collision` `[код]` `server.ts:6021-6036`.
- `501 permission_policy_not_implemented` / `not_implemented` `[код]` `server.ts:5406-5414,2857-2862`.
- `502 upstream_error` / `mcp_server_restart_failed` / `mcp_server_spawn_failed` `[код]` `server.ts:2894-2900,5750-5762,5955-5975`.
- `503 session_limit_exceeded` / `prompt_queue_full` / `acp_channel_unavailable` `[код]` `server.ts:5885-5906,5976-5983`.
- `413` тело >10MB; `401` Unauthorized `[код]` `auth.ts:272-332`.

---

## 4. СОБЫТИЯ SSE

Envelope: `id: <n>\nevent: <type>\ndata: <JSON>\n\n`, всегда `_meta.serverTimestamp` `[код]` `server.ts:5577-5600`. В опыте также наблюдались `heartbeat` (`: heartbeat`, каждые 15с) и `retry: 3000` `[опыт]` exp 2, `[код]` `server.ts:4650-4690`.

| type | data (ключи) | когда | источник |
|---|---|---|---|
| `session_update` | `sessionId, update:{sessionUpdate,content,_meta}` | user_message_chunk / agent_message_chunk / agent_thought_chunk / available_commands_update / shell_output | `bridge.ts:480,4557` |
| `turn_complete` | `sessionId, stopReason, promptId?` | завершение промпта | `bridge.ts:561` |
| `turn_error` | `sessionId, message, code?, promptId?` | ошибка промпта | `bridge.ts:624` |
| `prompt_cancelled` | `sessionId, reason?` | отмена | `bridge.ts:504` |
| `permission_request` | `requestId, sessionId, toolCall, options` | запрос разрешения | `bridgeClient.ts:404` |
| `permission_resolved` | `requestId, outcome, voterClientId?` | разрешение получено | `permissionMediator.ts:1012` |
| `permission_already_resolved` | `requestId, sessionId, outcome` | повторный голос | `permissionMediator.ts:559` |
| `permission_forbidden` | `requestId, sessionId, clientId?, reason` | голос отклонён политикой | `permissionMediator.ts:873` |
| `permission_partial_vote` | `requestId, sessionId, votesReceived, votesNeeded, quorum, optionTallies` | consensus-кворум | `permissionMediator.ts:782` |
| `session_died` | `sessionId, reason('killed'\|'daemon_shutdown')` | гибель сессии | `bridge.ts:4957,5104` |
| `session_closed` | `sessionId, reason, closedBy?` | закрытие | `bridge.ts:2527` |
| `model_switched` | `sessionId, modelId` | смена модели | `bridge.ts:1938` |
| `model_switch_failed` | `sessionId, requestedModelId, error` | ошибка смены модели | `bridge.ts:1652` |
| `approval_mode_changed` | `sessionId, previous, next, persisted` | смена режима | `bridge.ts:1953` |
| `settings_changed` | `key, value, scope?` | настройки | `bridge.ts:1637,4022` |
| `session_metadata_updated` | `sessionId, displayName, titleSource?` | переименование | `bridgeClient.ts:721, bridge.ts:3587` |
| `user_shell_result` | `sessionId, exitCode, signal, aborted` | результат shell | `bridge.ts:4601` |
| `followup_suggestion` | `sessionId, suggestion, promptId` | подсказка | `bridgeClient.ts:754` |
| `mid_turn_message_injected` | `sessionId, messages` | mid-turn | `daemonEventTypes.ts:18` |
| `elicitation_request` | `requestId, sessionId, message, mode, requestedSchema, toolCallId?` | elicitation | `daemonEventTypes.ts:29` |
| `elicitation_resolved` | `requestId, sessionId, outcome` | elicitation resolved | `daemonEventTypes.ts:38` |
| `mcp_budget_warning` | `liveCount, reservedCount, budget, thresholdRatio, mode` | бюджет MCP 75% | `bridgeClient.ts:774` |
| `mcp_child_refused_batch` | `refusedServers[], budget, liveCount, reservedCount, mode` | отказ пакета | `bridgeClient.ts:776` |
| `terminal_sequence` | — | terminal seq | `bridgeClient.ts:765` |
| `client_evicted` (без id) | `reason('queue_overflow'\|'writer_idle_timeout'), ...` | вытеснение подписчика | `eventBus.ts:280, server.ts:4815` |
| `state_resync_required` (без id) | `reason('ring_evicted'\|'epoch_reset'), lastDeliveredId, earliestAvailableId` | потеря событий | `eventBus.ts:397,413` |
| `replay_complete` (без id) | `lastReplayedEventId, lastEventId, replayedCount` | конец replay | `eventBus.ts:455` |
| `slow_client_warning` (без id) | `queueSize, maxQueued, lastEventId` | медленный клиент (75% очереди) | `eventBus.ts:317` |
| `stream_error` (без id) | `error, errorKind?` | ошибка итератора | `server.ts:4925` |
| `session_snapshot` (синтет.) | модель + approval mode | при attach/reconnect | `bridge.ts:2640-2677` |

Токены/usage **отдельным SSE-событием не эмитятся** — доступны через REST `GET /session/:id/stats`, `/context-usage` (структуры `ServeSessionStatsModelMetrics`/`ServeSessionContextUsage` в `status.ts:574-641`) `[код]`.

### JSON-примеры из опыта `[опыт]`

`turn_complete`:
```
data: {"v":1,"type":"turn_complete","data":{"stopReason":"end_turn","promptId":"ec159704-..."}}
```

`replay_complete` (на холодном restore):
```
data: {"v":1,"type":"replay_complete","data":{"lastReplayedEventId":56,"lastEventId":56,"replayedCount":56}}
```

`permission_request` (режим `default`, промпт с `write_file`):
```
data: {"requestId":"66abbc09-...","sessionId":"...","toolCall":{... "toolName":"write_file" ...},
       "options":[{"kind":"allow_always","optionId":"proceed_always"},
                  {"kind":"allow_once","optionId":"proceed_once"},
                  {"kind":"reject_once","optionId":"cancel"}]}
```

`session_metadata_updated` (авто-тайтл): `displayName:"Ответ на вопрос о столицах","titleSource":"auto"` `[опыт]` exp 2.

### Подписка

`GET /session/:id/events?maxQueued=N&snapshot=1` c заголовком `Last-Event-ID`. Поддерживается: reconnect по `Last-Event-ID`, ring-реплей, синтетические sentinel'ы. Heartbeat `: heartbeat` каждые 15с, `retry: 3000` `[код]` `server.ts:4650-4690`. Два клиента: лимит 64 подписчика; при переполнении очереди подписчика — `client_evicted` (тот, кто отстал) `[код]` `eventBus.ts:280`. Идle-таймаут писателя (`--writer-idle-timeout-ms`) шлёт `client_evicted{reason:'writer_idle_timeout'}` `[код]` `server.ts:4796-4830`.

Опыт `[опыт]` (exp 5): два параллельных `GET /events` + один промпт — оба клиента получили ОДИНАКОВЫЙ набор событий (ids 23–27, включая `turn_complete`); `client_evicted` не появился.

### permission_request

Ответ: `POST /permission/:requestId` или `POST /session/:id/permission/:requestId`, тело `{outcome:'selected', optionId}` или `{outcome:'cancelled'}` `[код]` `server.ts:5333-5355`. 200 — принято; 400 невалидный outcome; 403 `permission_forbidden` (designated/local-only); 404 requestId не найден. Таймаут — `--permission-response-timeout-ms` (default 300000мс=5мин); по истечении резолвится как `cancelled` `[код]` `permissionMediator.ts:377-426`, `serve.ts:250-253`.

Опыт `[опыт]` (exp 9): голос `POST /permission/:requestId {"outcome":{"outcome":"selected","optionId":"proceed_once"}}` → `200 {}`; пришло `permission_resolved` `{requestId, outcome:{outcome:"selected",optionId:"proceed_once"}}`.

Режимы разрешений: `KNOWN_APPROVAL_MODES = {plan, default, auto-edit, auto, yolo}` `[код]` `bridgeClient.ts:140-146`. По коду default — `'default'` `[код]` `bridge.ts:1240`; `yolo` = автоодобрение `[код]` `bridgeClient.ts:145`. **В опыте** дефолтный режим сессии из `state.modes` был `auto-edit` (авто-одобрение правок файлов), переключение `POST /session/:id/approval-mode {"mode":"default"}` → `{"previous":"auto-edit",...}` `[опыт]` exp 9. Расхождение зафиксировано в «Не проверено / риски». Смена — `POST /session/:id/approval-mode {mode,persist}` `[код]` `server.ts:4011`. Permission policy (медиатор) default `first-responder`; опции `first-responder|designated|consensus|local-only` `[код]` `permission.ts:34-40`.

---

## 5. ДОСТАВКА СООБЩЕНИЙ

- **Второй промпт во время первого:** встаёт в очередь (FIFO) ≤ `--max-pending-prompts-per-session` (default 5); при переполнении — **503** `prompt_queue_full` `[код]` `bridge.ts:2848-2855, server.ts:5897-5906`. Активный — один на сессию.
  Опыт `[опыт]` (exp 6): промпт «посчитай от 1 до 20» (медленно) + сразу «5+5» — оба вернули `200` со своими `promptId`; `turn_complete` пришли последовательно id31 («1..20») → id35 («5+5»); ответы «1,2,...,20» и «10».
- **`/mid-turn-message`** (`POST /session/:id/mid-turn-message`, `{message<=16KiB}`): пушит в очередь (≤20) без прерывания хода; ACP-ребёнок дренит её через `craft/drainMidTurnQueue` между tool-batch'ами — сообщение видно модели до конца хода. `{accepted:false}` если сессия простаивает/очередь полна (браузер держит копию и шлёт как новый промпт) `[код]` `server.ts:3854, bridge.ts:4551-4610,3065-3078`.
- **`/btw`** (`POST /session/:id/btw`, `{question}`): «by the way» — встраивание в текущий ход без прерывания `[код]` `server.ts:3790`.
- **`/heartbeat`**: `bridge.recordHeartbeat` — отметка живости клиента `[код]` `server.ts:3479`.
- **`/recap`**: однопредложительное резюме «где остановился», без хода модели `[код]` `server.ts:3760`.
- **Прерывание хода** — `POST /session/:id/cancel`: публикует `prompt_cancelled`, резолвит pending permissions как cancelled, шлёт ACP `cancel` (мимо очереди). Сессия **не закрывается**; активный промпт завершается `stopReason:'cancelled'` + `turn_complete`; промпты, уже поставленные в очередь, **продолжат выполняться** после cancel `[код]` `bridge.ts:3102-3182`.
  Опыт `[опыт]` (exp 12): длинный промпт, через ~5с `POST /session/:id/cancel` → `204`; вместо `turn_complete` пришли `prompt_cancelled` `{sessionId}` и `turn_error`; `hasActivePrompt` стал `false`; новый промпт «3*7» после cancel принят (`promptId`) — сессия работоспособна.

---

## 6. ОКРУЖЕНИЕ И БЕЗОПАСНОСТЬ

### env shell-инструментов

ACP-ребёнок (`nessy --acp`) наследует **весь `process.env` демона**, кроме `SCRUBBED_CHILD_ENV_KEYS` (`NESSY_SERVER_TOKEN` — токен демона, `NESSY_CLI_SIMPLE`), и получает `NESSY_CLI_NO_RELAUNCH='true'` `[код]` `spawnChannel.ts:119-127,263-264`. cwd ребёнка — `workspaceCwd` `[код]` `spawnChannel.ts:130`. Задать env **на сессию** — в коде не найдено (`POST /session` не читает env). env-снимок виден в `GET /workspace/env` `[код]` `env-snapshot.ts`.

Опыт `[опыт]` (exp 10): промпт «выполни `env | sort`» вернул полное окружение демона (`HOME=/Users/a.s.obraztsov`, `PWD=/private/tmp/nessy-lab-4200`, `NESSY_CLI_SESSION_ID=<sid>`, `NESSY_SERVE_MCP_BUDGET_MODE=off`, `NODE_EXTRA_CA_CERTS=...tinkoff-bundle.crt`). Сравнение 35 ключей env из сессии с env процесса serve (`ps eww`) — совпадение 100% (разница только `_`).

> ⚠️ **Находка безопасности.** Агент из сессии видит **полный env процесса демона**, включая живой секрет `LLM_PROXY_API_KEY` (JWT) `[опыт]` (exp 10). Значение секрета намеренно не приведено в отчёте и в этом документе. Это следствие того, что ACP-ребёнок наследует весь `process.env` демона (см. выше). Практический вывод: демон `nessy serve` следует запускать без секретов, которые не должны попадать в контекст модели, либо держать критичные ключи вне окружения демона.

### Песочница инструментов

**В daemon-режиме (`nessy serve`) Seatbelt-песочница НЕ применяется к ACP-ребёнку и его shell-инструментам**: `spawnChannel.ts` спавнит `node <nessy> --acp` напрямую, без обёртки `sandbox-exec` `[код]` `spawnChannel.ts:131-140`; `start_sandbox` (обёртка через `sandbox-exec`) вызывается только в интерактивном TUI-запуске `[код]` `gemini.tsx:701`; в `packages/cli/src/serve/` нет вызовов sandbox-обвязки (только отчётность env) `[код]` grep serve → нет `sandbox-exec`. Конфиг сандбокса существует (`sandboxConfig.ts`), профиль по умолчанию `permissive-open` `[код]` `sandbox.ts:192`, но он применяется только при `start_sandbox` (интерактив). ⇒ **сеть (в т.ч. 127.0.0.1:4337), чтение home и пр. — доступны без ограничений в демон-режиме по умолчанию**. Если оператор сам запускает весь `nessy serve` под `sandbox-exec` (например `SANDBOX=sandbox-exec` в env, который наследуется ребёнком), профиль `permissive-open` разрешает `(allow default)` и лишь запрещает запись вне заданных путей `[код]` `sandbox-macos-permissive-open.sb:1-24` — сеть и чтение home в нём **разрешены**. `NESSY_SANDBOX` (false/docker/podman/sandbox-exec) читается `sandboxConfig.ts:41-72`.

Опыт `[опыт]` (exp 11): промпт «curl http://127.0.0.1:4395/health» → `HTTP=200` (из сессии доступен локальный сетевой стек демона); промпт «ls ~ | head» → полный список домашней директории пользователя. Никакой изоляции (`NESSY_SANDBOX` не задан).

### Права

approval modes см. §4 (`plan|default|auto-edit|auto|yolo`, по коду default `default`). Permission policy default `first-responder` `[код]` `permission.ts:34-40`. Смена режима — `POST /session/:id/approval-mode`. Автоодобрение = `yolo` `[код]` `bridgeClient.ts:145`; в опыте дефолт сессии — `auto-edit` (см. §4, расхождение). Bearer-токен обязателен вне loopback или с `--require-auth`; на loopback по умолчанию открыто `[код]` `run-nessy-serve.ts:523-541,1236-1238`.

---

## Не проверено / риски

- **Модель по умолчанию**: по коду дефолт `qwen3-coder-plus` `[код]`, по опыту дефолт сессии `tgpt/deepseek-v4-flash-0731(dp-auth)` `[опыт]`. Обе версии зафиксированы, ни одна не выбрана «молча». Вероятная причина — жёсткий дефолт в коде vs конфиг/модель-сервис окружения: в эксперименте провайдер `dp-auth` реально подставил DeepSeek V4 Flash (в коде этого провайдера/пресетов дефолт Qwen, но runtime выбирает модель по конфигу/сервису). Требует подтверждения на чистом демоне без кастомного окружения.
- **Дефолтный approval mode**: по коду `default` `[код] bridge.ts:1240`, в опыте на сессии наблюдался `auto-edit` `[опыт]`. Требует проверки на чистом демоне.
- «load + prompt сразу» на холодном restore — гонки не проверяли; вероятен 404 `[догадка]`.
- Точное поведение `/acp` WebSocket-транспорта детально не разбиралось (отдельный транспорт).
- Эксперименты проводились до ~16 ходов (~60 SSE-событий, 63 строки истории); тренд роста `/load` при 50/500 ходах не мерился.
- В опыте (exp 9) ход после голоса по `write_file` завис (много `agent_thought_chunk`, `turn_complete` не пришёл за ~2 мин); файл не создан. Причина не установлена `[догадка]`: медленная генерация модели, а не отказ permission.

**Статус**: DONE — документ собран по обоим отчётам; расхождения code-study vs experiments отмечены в «Не проверено / риски».