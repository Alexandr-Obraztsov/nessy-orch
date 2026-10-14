# Отчёт: фактика `nessy serve` (HTTP/SSE над Qwen Code) живыми экспериментами

Агент: nessy-experiments (a-eyrd). Дата: 2026-10-14. Версия CLI: `nessy 0.13.16`.
Эксперименты проведены на собственном экземпляре `nessy serve` на портах 4395 и 4400.
Порт оркестратора 4337 НЕ трогался. Исходники не изменялись, коммитов нет.
Метка каждого вывода: [опыт] — наблюдал; [код] — по исходникам `nessy-cli/`; [догадка] — гипотеза.

> Важно (расхождение с постановкой): brief говорит «обёртка над Qwen Code». По факту
> дефолтная модель сессии — `tgpt/deepseek-v4-flash-0731(dp-auth)` (DeepSeek V4 Flash);
> Qwen 3.5 397B доступен в списке моделей как опция (`tgpt/qwen35-397b-a17b-fp8(openai)`).
> [опыт] (см. exp 3, поле `state.models`).

---

## 1. Запуск serve, корневой/health/capabilities

Запуск (демон с токеном, bound-воркспейс, без веб-UI):
```
nessy serve --port 4395 --hostname 127.0.0.1 --token lab-token --workspace /private/tmp/nessy-lab-4200 --no-web
```
Вывод старта:
```
nessy serve: --token is visible in the process command line; prefer the NESSY_SERVER_TOKEN env var...
nessy serve: daemon log → ~/.nessy/debug/daemon/serve-4554-....log
nessy serve: session reaper started (interval 60000ms, idle threshold 1800000ms)
nessy serve listening on http://127.0.0.1:4395 (mode=http-bridge, workspace=/private/tmp/nessy-lab-4200)
nessy serve: /acp WebSocket transport enabled on /acp
```
- `GET /health` (без токена): `200 {"status":"ok"}`. [опыт]
- `GET /` (без токена): `401 {"error":"Unauthorized"}`. [опыт]
- `GET /capabilities` (Bearer): `{"v":1,"mode":"http-bridge","nessyCodeVersion":"0.13.16", "features":[...]}`. [опыт]
  Подтверждает протокол v1, режим http-bridge; `workspaceCwd` = bound-воркспейс. [код: packages/cli/src/serve/capabilities.ts]

## 2. Создание сессии POST /session + SSE

`POST /session` `{"cwd":"/private/tmp/nessy-lab-4200"}` →
```
{"sessionId":"3bcd3144-...","workspaceCwd":"/private/tmp/nessy-lab-4200","attached":false,
 "clientId":"client_42824520-...","createdAt":"2026-10-14T09:20:32.917Z"}
```
`POST /session/:id/prompt` `{"prompt":[{"type":"text","text":"Назови три столицы мира. Отвечай кратко."}]}` →
`{"promptId":"ec159704-...","lastEventId":1}`

SSE-подписка: `GET /session/:id/events` с `Accept: text/event-stream` и `Last-Event-ID: 0`.
Наблюдаемые типы событий (примеры, envelope `{id?,v,type,data}`): [опыт]
- `session_update` с `sessionUpdate`: `available_commands_update`, `user_message_chunk` (эхо промпта),
  `agent_message_chunk` (фрагменты ответа + usage), `agent_thought_chunk` (рассуждения).
- `turn_complete` `{"stopReason":"end_turn","promptId":"..."}`.
- `session_metadata_updated` (авто-тайтл: `displayName:"Ответ на вопрос о столицах","titleSource":"auto"`).
- `replay_complete` (после Last-Event-ID:0), `followup_suggestion`, `heartbeat` (каждые 15с).
Ответ модели: «Москва, Париж, Вашингтон.»

## 3. DELETE → /load → вопрос о первом промпте; затем рестарт serve

`DELETE /session/:id` → `204 No Content`. [опыт]
`POST /session/:id/load` (после DELETE) → `200` c `attached:false`, `liveJournal` (история),
`lastEventId`, `state` (`modes.currentModeId="auto-edit"`, `models`, `configOptions`). [опыт]
Вопрос «Что я просил в первом промпте?» → модель ответила: «Вы просили назвать три столицы мира и ответить кратко.» → история восстановлена после DELETE. [опыт]

**Рестарт**: убил демон (SIGTERM), запустил снова на том же порту, `POST /session/:id/load` того же id:
- `200`, `attached:false`, время **2.14с**, тело **36953 байта**, `lastEventId:50`, `liveJournal_len:50`. [опыт]
- Тот же вопрос → «В первом промпте вы просили назвать три столицы мира и ответить кратко.» → история переживает рестарт. [опыт]

## 4. /load БЕЗ delete — replay событиями

На холодном restore (после рестарта) подписка с `Last-Event-ID:0`:
```
event: replay_complete
data: {"v":1,"type":"replay_complete","data":{"lastReplayedEventId":56,"lastEventId":56,"replayedCount":56}}
```
История проигрывается как `session_update` с id 1..56, затем `replay_complete`, затем новые события идут подряд (id продолжаются, монотонно). Отличить повтор от нового можно: replay-фреймы идут до `replay_complete`; новые — после него, с возрастающими `id`. [опыт]
Нюанс: если подписка открыта ДО `load` (сессия ещё не в кольце), replay не прилетает — нужно подписаться после `load` с `Last-Event-ID:0`. [опыт]
На уже-живой сессии `/load` возвращает `attached:true` и `liveJournal_len:1` (только хвост) — полного replay нет. [опыт]

## 5. Два SSE-клиента на одну сессию

Два параллельных `GET /session/:id/events` + один промпт «2+2». Оба клиента получили ОДИНАКОВЫЙ набор событий (ids 23–27, включая `turn_complete`); ответ «4». `client_evicted` не появился (0 вхождений). [опыт]
`client_evicted` — синтетический терминальный фрейм при переполнении очереди медленного подписчика (пер-подписчик, default `maxQueued:256`); не срабатывает на быстром потребителе. [код: packages/cli/src/serve/event-bus.ts, docs §GET /session/:id/events]

## 6. Второй prompt во время первого

Сначала «посчитай от 1 до 20» (медленно), затем СРАЗУ «5+5». Оба запроса вернули `200` со своими `promptId` (ошибки нет) — сервер ставит промпты в FIFO-очередь (ACP: один активный промпт на сессию). `turn_complete` пришли последовательно: id31 (промпт «1..20») → id35 («5+5»). Ответы: «1, 2, ..., 20» и «10». [опыт] [код: docs §POST /session/:id/prompt «Multi-prompt callers FIFO-queue per session»]

## 7. /load и prompt сразу подряд

`POST /load` затем немедленно `POST /prompt` без ожидания повтора — оба вернули `200`; на живой сессии load быстрый (attached). Промпт принят (`promptId`, `lastEventId:36`). [опыт]
На холодном restore гонку повтора/нового промпта явно не провоцировал — на живой сессии работает.

## 8. --max-sessions 1

Отдельный демон `--max-sessions 1` на порту 4400.
- 1-я `thread`-сессия: `200 attached:false`. [опыт]
- 2-я `thread`-сессия при занятом слоте: `503` `{"error":"Session limit reached (1)","code":"session_limit_exceeded","limit":1}` + `Retry-After:5`. [опыт]
- Attach (single-scope POST того же воркспейса) при полном слоте: `200 attached:true` — attach НЕ считается в лимит. [опыт]
- `thread`-сессия при занятом single-слоте: `503` (thread не становится attach-целью для single-scope). [опыт]
- `DELETE` освобождает слот: после DELETE новая thread-сессия создалась `200`. [опыт]
- «После detach»: явного detach-роута нет; освобождение по таймауту — session reaper (`--session-idle-timeout-ms`, default 30 мин). [код: `nessy serve --help`]

## 9. permission_request

Режим по умолчанию из `state.modes` — `auto-edit` (авто-одобрение правок файлов). Для провокации переключил в `default`: `POST /session/:id/approval-mode {"mode":"default"}` → `{"previous":"auto-edit",...}`. [опыт]
Промпт «создай файл .../perm-test.txt» → событие `permission_request`:
```
data: {"requestId":"66abbc09-...","sessionId":"...","toolCall":{... "toolName":"write_file" ...},
       "options":[{"kind":"allow_always","optionId":"proceed_always"},
                  {"kind":"allow_once","optionId":"proceed_once"},
                  {"kind":"reject_once","optionId":"cancel"}]}
```
Голос `POST /permission/:requestId {"outcome":{"outcome":"selected","optionId":"proceed_once"}}` → `200 {}`; событие `permission_resolved` `{requestId, outcome:{outcome:"selected",optionId:"proceed_once"}}`. [опыт]
- Таймаут permission по умолчанию 5 мин (`DEFAULT_PERMISSION_TIMEOUT_MS`), конфигурируется `--permission-response-timeout-ms`. Не ждал 5 мин — [код: docs §POST /permission, `nessy serve --help`].
- Автоодобрение по умолчанию: режим `auto-edit` (правки файлов без запроса) — [опыт] (state.modes) + [код].
- Итог записи файла: ход завис (много `agent_thought_chunk`, `turn_complete` не пришёл за ~2 мин); отменил через `POST /cancel`. Файл не создан. Причина не установлена [догадка]: медленная генерация модели, а не отказ permission.

## 10. env из сессии

Промпт «выполни `env | sort` и верни вывод». Агент вернул полное окружение демона: `HOME=/Users/a.s.obraztsov`, `PWD=/private/tmp/nessy-lab-4200`, `NESSY_CLI_SESSION_ID=<sid>`, `NESSY_SERVE_MCP_BUDGET_MODE=off`, `NODE_EXTRA_CA_CERTS=...tinkoff-bundle.crt` и др. [опыт]
Сравнение ключей env из сессии (35) с env процесса serve (PID 4554, `ps eww`): совпадение 100% (разница только `_`). → агент видит ПОЛНОЕ окружение процесса демона, без песочницы. [опыт]
⚠️ Безопасность: в окружении агента доступен живой секрет `LLM_PROXY_API_KEY` (JWT). Значение намеренно не привожу в отчёте. [опыт]

## 11. Сеть и дом. каталог из сессии

Промпт «curl http://127.0.0.1:4395/health» и «ls ~ | head»:
```
HTTP=200
AndroidStudioProjects Applications Desktop Documents Downloads Library Movies Music Pictures Projects Public SkyGuard boxy grafana-login java_error_in_studio.hprof scripts vault
```
→ из сессии доступен локальный сетевой стек демона (200) и реальный `$HOME` пользователя (весь список домашней директории). Никакой изоляции (NESSY_SANDBOX не задан). [опыт]

## 12. Отмена хода

Длинный промпт «перечисли от 1 до 50 с пояснением», через ~5с `POST /session/:id/cancel` → `204 No Content`.
Вместо `turn_complete` пришли события `prompt_cancelled` `{sessionId}` и `turn_error`. `hasActivePrompt` стал `false`. Новый промпт «3*7» после cancel принят (`promptId`). → сессия работоспособна после отмены. [опыт]

## 13. Замер /load

Сессия к моменту замера: ~16 ходов / ~60 SSE-событий / 63 строки истории. `POST /session/:id/load` после рестарта: **2.14с**, тело **36953 байта**, `liveJournal_len:50`. [опыт]
Честная оценка масштаба: дошёл до ~16 ходов (не 50/500 — модель медленно генерирует на длинной истории). Линейный рост ожидаем (replay через кольцо `--event-ring-size`, default 8000) — [код], но тренд на данном масштабе не мерил.

## 14. Что на диске

История сессии лежит в `~/.nessy/`, а не в воркспейсе:
```
~/.nessy/projects/-private-tmp-nessy-lab-4200/chats/3bcd3144-....jsonl   (63 строки, 57053 байта)
```
Формат: JSONL, по строке на запись `{uuid, parentUuid, sessionId, timestamp, type(user|system|assistant), cwd, version, message|model, ...}`. [опыт]
`DELETE /session/:id` файл НЕ удаляет (переживает delete и рестарт) — соответствует доке. [опыт] [код: docs §DELETE /session/:id]
Воркспейс `/private/tmp/nessy-lab-4200` оставался пустым (история только в `~/.nessy`).

---

## Cleanup
- serve (порт 4395) остановлен, второй демон (4400) остановлен. Порты 4395/4400 свободны.
- Временные сессии удалены: `~/.nessy/projects/-private-tmp-nessy-lab-4200/` (все .jsonl) и lab-папка `/private/tmp/nessy-lab-4200`; временные логи очищены.
- Порт оркестратора 4337 не затрагивался.

## Источники
- Протокол: `nessy-cli/docs/developers/nessy-serve-protocol.md` (роуты, ошибки, SSE, permission).
- Интеграционные тесты: `nessy-cli/integration-tests/cli/nessy-serve-routes.test.ts`, `nessy-serve-streaming.test.ts`.
- Флаги serve: `nessy serve --help`.
- Запуск: `nessy serve --port 4395 --hostname 127.0.0.1 --token lab-token --workspace /private/tmp/nessy-lab-4200 --no-web`.

Статус: DONE — 14/14 пунктов закрыты, serve остановлен, временные сессии удалены.