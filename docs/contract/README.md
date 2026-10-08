# Контракт `nessy serve` (ACP) — референс

Источники правды (проверено против `nestor/assistant` + живого serve):

- `reference/nessy-acp-agent/adapter/nessy-agent.ts` — **как serve ГЕНЕРИРУЕТ session_update события**
- `reference/nessy-acp-agent/adapter/tool-call-mapper.ts`, `acp-mappers.ts` — структура tool_call/tool_call_update
- `reference/nessy-acp-agent/core/session/events.ts`, `types.ts` — типы событий и TStateUpdate
- `reference/nessy-acp-agent/tools/types.ts` — IToolCall
- `reference/vscode-acp-agent/acpSessionUpdateAdapter.ts` — **как ВНЕШНИЙ клиент ПРАВИЛЬНО парсит session_update** (накопление по messageId, буфер toolCallId, buildToolOutput)
- `reference/vscode-acp-agent/acpStreamProcessor.ts` — парсер SSE-фреймов
- `reference/nessy-acp-agent/docs/*.md` + `reference/rfc/nessy-acp-agent_rfc.md` — документация

## sessionUpdate-события (внутри `session_update`)

| sessionUpdate | Поля | Назначение |
|---|---|---|
| `user_message_chunk` | `content`{type,text}, `messageId` | эхо сообщения пользователя |
| `agent_message_chunk` | `content`{type,text,[_meta]}, `messageId` | текст ассистента; `_meta['nessy/error']` = ошибка turn |
| `agent_thought_chunk` | `content`{type,text}, `messageId` | мысли ассистента |
| `tool_call` | `toolCallId`,`title`,`rawInput`,`content[]`,`kind`,`locations`,`status` | старт инструмента |
| `tool_call_update` | `toolCallId`,`status`,`rawOutput`,`content[]` | прогресс/результат инструмента |
| `current_mode_update` | `currentModeId` | смена режима |
| `session_info_update` | `_meta` | служебное (rate-limit retry) |
| `available_commands_update` | `availableCommands` | список команд/скиллов |

## tool_call / tool_call_update

`tool_call` → `toolCallId, title, rawInput, content, kind, locations, status` (status: pending|in_progress|completed|failed).
`tool_call_update` → `toolCallId, status, rawOutput, content`. **`title`/`rawInput` могут быть только в tool_call** — клиент должен буферизовать по `toolCallId`.

**Вывод инструмента** (`rawOutput` + `content`) — объединять с **дедупликацией** (см. `buildToolOutput` в acpSessionUpdateAdapter):
- `content[].type === 'content'` → `content.content.text`
- `content[].type === 'diff'` → diff-текст
- `content[].type === 'terminal'` → `Terminal: <id>`
- `rawOutput` может быть пустой строкой при непустом `content` (и наоборот) — брать оба, убирать дубли.

## Ошибка turn

`agent_message_chunk` c `content._meta['nessy/error'] = { message, retryable?, code?, requestId? }` — ошибка, не текст.

## События верхнего уровня (type=)

`session_update`, `turn_complete`, `session_metadata_updated`, `replay_complete`, `prompt_cancelled`, `permission_request`, `session_died`, `session_closed`, `client_evicted`, `followup_suggestion`, `available_commands_update`, `workspace_*`, `mcp_*`.

## Эндпоинты (подтверждено живьём)

| Метод | Путь | Тело → ответ | Статус |
|---|---|---|---|
| POST | /session | `{cwd, sessionScope:'thread'}` → `{sessionId, workspaceCwd, attached, clientId, createdAt}` | ✅ |
| POST | /session/:id/prompt | `{prompt:[{type:'text',text}]}` → `{promptId, lastEventId}` | ✅ |
| GET | /session/:id/events | SSE, replay `Last-Event-ID` | ✅ |
| POST | /session/:id/load | `{cwd}` → 200 | ✅ |
| POST | /session/:id/cancel | `{}` → 204 (+ событие `prompt_cancelled`) | ✅ |
| DELETE | /session/:id | → 204; повторный 404 | ✅ |
| GET | /workspace/mcp | список MCP | ✅ |
| POST | /session/:id/shell | требует token + client id | ⚠️ не проверено |
| POST | /session/:id/permission/:requestId | `{outcome:{outcome:'selected',optionId}\|{outcome:'cancelled'}}` | ⚠️ формат из кода |
| GET | /session/:id/context, /stats, /tasks, /supported-commands, /hooks, /lsp, /rewind/snapshots, /context-usage | | из кода |
| POST | /session/:id/detach, /fork, /branch, /resume, /recap, /model, /language, /btw, /mid-turn-message, /heartbeat | | из кода |
| POST | /sessions/delete | | из кода |
| GET | /workspace/{settings,env,tools,agents,skills,hooks,memory,preflight,providers,init,auth/*} | | из кода |

## Правки клиента (выполнены)

Реализация переехала из `src/core/nessy-client.ts` в `src/infrastructure/nessy/`: `event-mapper.ts` (кадры → `SessionEvent`,
буфер инструментов), `tool-output.ts` (`buildToolOutput`), `nessy-client.ts` (HTTP/SSE-клиент, `Last-Event-ID`).

1. [x] **`tool_call_update` output** — `rawOutput + content` с дедупликацией, `content.type` = content/diff/terminal (`tool-output.ts`).
2. [x] **`agent_message_chunk` error-meta** — `content._meta['nessy/error']` → событие `turn_error` (message/retryable/code), не текст.
3. [x] **`messageId`** — пробрасывается в `text`/`thought` для группировки chunks.
4. [x] **Буфер `tool_call`/`tool_call_update` по `toolCallId`** — мерж title/rawInput/status/content (`mergeToolCall`).
5. [x] **`status`** — только `pending|in_progress|completed|failed`; `cancelled`/`error` отображаются в `failed`.
6. [x] **`prompt_cancelled`** — событие `cancelled`.
7. [x] **`followup_suggestion`** — событие `followup` (оркестратор его не использует).
8. [x] Факт `rawOutput=""` + `content` учтён (см. выше) — отдельного `docs/nessy-contract.md` нет, актуален этот файл.
