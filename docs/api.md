# HTTP / SSE API оркестратора

База: `http://127.0.0.1:4337` (`ORCH_PORT`). Тела — JSON (`Content-Type: application/json`). Типы — `shared/types/` (`domain.ts`, `events.ts`, `api.ts`); реализация — `src/interfaces/http/`.

## Общие правила

- **Безопасность:** заголовок `Host` обязан быть `127.0.0.1:<порт>` / `localhost:<порт>` / `[::1]:<порт>`, иначе `403 bad_host`.
  Если есть `Origin` — только `http://127.0.0.1:<порт>` или `http://localhost:<порт>`, иначе `403 bad_origin`.
  Следствие: браузерные клиенты с другого origin не работают; приложение и CLI ходят без `Origin`.
- **Доступ.** Сервис создаёт токен оператора в `<home>/token` (0600). Запрос с `X-Orch-Token: <токен>` — оператор: приложение и терминал
  главного агента (в нём переменная `NESSY_ORCH_TOKEN`, CLI подставляет заголовок сам). Без токена доступно чтение (`GET`) и
  команды **от имени агента**: `POST /agents`, `/agents/:ref/send`, `/agents/:ref/plan` с `from: <id агента>` и
  заголовком `X-Agent-Key: <ключ>` (CLI: `--from <id> --key <ключ>`; ключ агент берёт из своей вводной, в API он не отдаётся). Остальное
  без токена — `403 operator_required`; чужой или неверный ключ — `403 bad_agent_key`; `from: you|user` или без `from` — только оператору.
  Агент без токена не выбирает `parent` (это вызвавший агент). Зачем: агенты nessy работают в окружении демона (оно общее для всех сессий,
  отдельного env на сессию задать нельзя) и не должны выдавать себя за оператора; терминал оператора этого окружения не наследует.
- **Ошибки:** статус ≥ 400, тело `{ "error": "<текст>", "code": "<код>" }`. Коды: `bad_request`, `bad_json`, `bad_path`,
  `bad_from`, `empty_text`, `self_send`, `space_required` (все 400), `no_space` (404), `space_exists` (409),
  `space_busy` (409), `no_agent` (404), `ambiguous_agent` (409), `name_taken` (409), `busy` (409, архив работающего агента),
  `no_role` (404), `role_exists` (409), `no_case` (404), `no_job` (404), `no_candidate` (404), `case_busy` (409), `job_not_failed` (409), `learning_unavailable` (503), `no_playbook` (404), `playbook_busy` (409), `hop_limit` (429), `rate_limit` (429),
  `deadlock` (409), `nessy_error` (502), `too_large` (413, тело > 5 МБ), `bad_host`/`bad_origin`/`forbidden` (403),
  `not_found` (404), `internal` (500). Пустое тело запроса читается как `{}`.
- **Ссылка на агента `:ref`** — id (`a-7f3k`) или уникальное имя (без учёта регистра). Особое значение `you` допустимо
  только как адресат `send`.
- Отдельного версионирования нет; изменения — обратно совместимые добавления полей.

## Служебное

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/health` | `{status:"ok"}` |
| GET | `/status` | `StatusResponse` (`version,pid,uptimeSec,rev,home,autoApprove,spaces,agents,working,roles`) |
| GET | `/graph` | `GraphView` = `{rev, spaces[], agents[], roles[]}` (агенты — включая архивных) |

Сервер отдаёт только API (статики нет): первые сегменты маршрутов — `health status graph stream spaces agents roles sessions messages inbox`; неизвестный маршрут → `404 not_found`.

## Пространства

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/spaces` | — | `SpaceView[]` |
| POST | `/spaces` | `{path (абсолютный, обязателен), name?, url?}` | `201 SpaceView`; `path` должен быть абсолютным путём к существующему каталогу, иначе `400 bad_path`; существующий path возвращает имеющееся пространство; занятое `name` → `409 space_exists` |
| DELETE | `/spaces/:name?force=1` | — | `{ok:true}`; неизвестное имя → `404 no_space`; без `force=1` при наличии агентов → `409 space_busy` (с `force=1` агенты удаляются) |

## Агенты

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/agents?session=<id>` | — | `AgentView[]` (включая архивных — фильтрует клиент по `archived`); `session` — только агенты сессии, неизвестная → `404 no_session` |
| POST | `/agents` | `SpawnRequest` (`title?` — короткий заголовок; `name` — техническое имя; занятое получает суффикс -2, -3, настоящее возвращается в `agent.name`) | `201 SpawnResponse`. `session` — id сессии (`404 no_session`); без него агент получает сессию родителя (`parent`/`from`-агента) или `null` |
| GET | `/agents/:ref/wait?timeout=СЕК` | — | `WaitResponse {done, agent, reply?}`: дождаться, пока агент освободится (ход и очередь закончены), и получить его последний ответ; `done:false` — время вышло, агент ещё работает |
| GET | `/agents/:ref` | — | `AgentView` |
| DELETE | `/agents/:ref` | — | `{ok:true}` (отмена хода, закрытие сессии, архив истории) |
| POST | `/agents/:ref/send` | `SendRequest` | `SendResponse`; `started` — адресат был свободен и сообщение запустило его в работу, `interrupted` — работавшему прерван ход, `queued` — встало в очередь |
| POST | `/agents/:ref/cancel` | `{}` | `AgentView` (прервать ход, очистить очередь) |
| POST | `/agents/:ref/archive` | `{}` | `AgentView` (`archived:true`); агент работает или у него очередь → `409 busy` |
| POST | `/agents/:ref/restore` | `{}` | `AgentView` (`archived:false`, без сообщения) |
| POST | `/agents/:ref/permission/:requestId` | `{approve:boolean}` (по умолчанию `true`) | `{ok:true}`; если запрос не найден (или нет соединения) — `404 {ok:false}`. Тело без `approve:false` означает «разрешить» |
| GET | `/sessions?status=active\|done` | — | `SessionView[]`: сначала активные, затем по свежести |
| POST | `/sessions` | `SessionRequest {title?, owner?, id?, cwd?, chatId?}` | `201 SessionView` (с `unread`); без `title` — имя папки `cwd` (вкладка проекта); `chatId` — id чата Claude (`--session-id`), занятый другой сессией — `409 chat_bound`; id по умолчанию — slug заголовка (кириллица транслитерируется, пусто → `session`) + `-` + 4 hex; занятый явный `id` — `409 session_exists` |
| POST | `/sessions/attach` | `AttachRequest {chatId, cwd?, from?}` | `SessionView`: сессия чата Claude (нет — создаётся в `cwd` или каталоге `from`); у `from` поле `successor` указывает на результат (после `/clear`, `/resume`); оператору |
| GET | `/sessions/:id` | — | `SessionView` или `404 no_session` |
| PATCH | `/sessions/:id` | `SessionPatch {title?, status?, summary?}` | `SessionView` (`updatedAt` обновляется); `status: done` ставит оркестратор или человек из приложения |
| POST | `/sessions/:id/closed` | — | `{cancelled}`: вкладка закрыта, работающие агенты сессии остановлены, сессия остаётся (`lead.state: ended`) |
| DELETE | `/sessions/:id` | — | `{ok:true}`; в сессии работают агенты (ход или очередь) → `409 session_busy`; агенты сессии остаются с `session:null`, курсор inbox и источники сессии забываются |
| GET | `/sessions/:id/sources` | — | `SourceView[]` по порядку появления: ссылки из итоговых ответов агентов («Источники») и из входа их вызовов инструментов, без дублей; `404 no_session` |
| POST | `/agents/:ref/plan` | `PlanRequest {from?, entries:[{content, status}]}` | `AgentView` с новым планом (заменяет прежний целиком). Неверные записи → `400 bad_plan`; `from` указан и ≠ id агента → `403 forbidden` |
| DELETE | `/agents/:ref/plan?from=<id>` | — | `AgentView` с `plan:null` (те же правила `from`) |
| GET | `/agents/:ref/history?limit=400` | — | `AgentEvent[]` по возрастанию `seq` (последняя запись с данным `seq` побеждает); включает незавершённый блок текста |

### Сессия, источники и счётчики

**Сессия** — вкладка проекта (её создаёт приложение: `POST /sessions {cwd, chatId}`) или один разговор Claude вне приложения; все его агенты
запускаются в ней (`session` в `SpawnRequest`), у сессии свои источники и счётчики. Ящика входящих нет: `spawn` и `send` с `wait` возвращают ответ вызвавшему. Несколько Claude работают параллельно в своих сессиях.
`SessionView.sources` — сколько источников собрано; список — `GET /sessions/:id/sources` (сохраняется в `sources/<id>.jsonl`).

`AgentView.stats` = `{turns, toolCalls, workMs, tokens}`: завершённые ходы, вызовы инструментов, суммарное время ходов (мс) и токены
`{input, output, cached, total}` (`null`, если nessy их не сообщает). Токены — нарастающий итог из `GET /session/:id/stats`:
сумма `models.<модель>.tokens.{prompt, candidates, cached, total}` по всем моделям сессии. Заполнение контекста — из
`GET /session/:id/context-usage`: `usage.totalTokens` (занято) и `usage.contextWindowSize` (окно модели) → `contextTokens`, `contextPct`;
нет ответа — поля пусты, значения по умолчанию нет. Оба опрашиваются каждые 5 с, пока идёт ход, и в конце хода.

`AgentView.lastReply.status` / `.reason` — статус из последней строки ответа агента (`Статус: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT — причина`), если он его указал.
У `ToolEvent` в чате есть `endedTs` (когда вызов завершился): длительность = `endedTs − ts`.

Ход, который шёл в момент остановки оркестратора, при следующем запуске завершается ошибкой «оркестратор был перезапущен во время хода»
(ответ отправителю, в том числе ждущему `--wait`, и запись в чате); агент в статусе `error` и принимает новые сообщения.

### Статусы и архив

`AgentView.status`: `starting` (создаётся сессия) → `idle` ⇄ `working`; `error` — последний ход завершился ошибкой или упала
сессия nessy (текст в `error`). Состояний «сна» и «смерти» нет: следующее сообщение агенту в `error` доставляется как обычно
(упавшая сессия пересоздаётся, в чат пишется «сессия nessy пересоздана, контекст сброшен»).

`AgentView.archived`: агент **успешно** закончил ход и очередь пуста → `archived:true` (скрыт из рабочего списка; сессия nessy
и подписка сохраняются). Ход с ошибкой или прерванный ход агента в архив не уводят. Любое сообщение агенту в архиве
(от you или от агента) возвращает его (`archived:false`) и доставляется — с прежним контекстом. Агент, созданный без
`prompt`, остаётся видимым (`idle`). Флаг переживает рестарт; после рестарта все агенты `idle`, сессия поднимается
при первом сообщении (`POST /session/:id/load`, не вышло — новая сессия с записью «контекст сброшен»).

### План, шаги хода и последний ответ

`AgentView.plan` — план агента или `null`: `{entries:[{content, status}], updatedAt, source}`, статус шага —
`pending | in_progress | completed`. Агент сообщает план сам: через CLI (`nessy-orch plan --from <id> "- [x] …" "- [~] …" "- [ ] …"`,
`source:'cli'`) или через ACP `session_update` `plan` от nessy (`source:'acp'`). Каждое обновление заменяет план целиком.
Проверка (HTTP/CLI): 1..30 записей, `content` после trim — 1..300 символов. План из ACP нормализуется мягко (пустые
записи отбрасываются, длинные усекаются); ACP-план вне хода (реплей) игнорируется.
Сброс: новое сообщение от `you`, которое начинает ход, когда очередь пуста, а прежний план выполнен целиком, — план
становится `null`. В остальных случаях (уточнение при недоделанном плане, работа в очереди, сообщение от агента) план
сохраняется. Изменения приходят обычным событием `agent` потока `/stream`.

`AgentView.turnSteps` — число разных вызовов инструментов (`toolId`) в текущем ходе; обнуляется в начале хода, после
хода показывает счёт последнего. `AgentView.lastTurnMs` — длительность последнего завершённого хода, мс (`null` — ходов
не было). `AgentView.lastReply` — последний ответ агента оператору (`you`): `{msgId, ts, failed?, preview}`, `preview` —
до 200 символов простого текста. Всё перечисленное сохраняется в `state.json` и переживает рестарт.

### SpawnRequest

```jsonc
{ "cwd": "/abs/dir",     // каталог вызывающего (CLI шлёт свой): пространство, если space не указан и пространств не одно
  "space": "main",        // имя ИЛИ абсолютный путь (неизвестный путь создаёт space); можно опустить, если space один (иначе 400 space_required)
  "name": "reviewer",     // опционально, уникально; иначе = id (с ролью — id роли: reviewer, reviewer-2, …)
  "role": "reviewer",     // опционально: id или имя роли (без учёта регистра); неизвестная → 404 no_role
  "prompt": "задача",     // опционально: если задан — отправляется сразу
  "from": "you",          // отправитель стартового сообщения (id агента, если агент спавнит агента)
  "parent": "you",        // родитель в графе; по умолчанию = from
  "wait": true,           // дождаться ответа на prompt
  "waitTimeoutSec": 600 }
```

`SpawnResponse` = `{agent, message?, reply?, timedOut?}` (`message` — стартовое сообщение; без `prompt` его нет). Занятое имя → `409 name_taken`.
С ролью `agent.role` = id роли, а инструкции роли добавляются во вводную агента (раздел «Твоя роль: <имя>»).

### SendRequest / SendResponse

```jsonc
{ "text": "…", "from": "you", "interrupt": false, "wait": false, "waitTimeoutSec": 600 }
// → { "message": Message, "reply"?: Message, "timedOut"?: true }
```

Без `wait` ответ приходит позже: в ленте и в потоках, а получить его можно `GET /agents/:ref/wait`. `from` — id или имя агента, от чьего
имени пишем (так делают сами агенты; неизвестный → `400 bad_from`). `:ref` может быть `you` (сообщение главному узлу).
Текст обрезается по краям, пустой → `400 empty_text`. С `wait` вызов ждёт ответ до `waitTimeoutSec` (по умолчанию 600);
по таймауту возвращается `timedOut:true`.

`from: "user"` — человек, пишущий агенту из приложения. Ответ агента идёт ему (`to: user`); главному агенту копий нет (переписка с агентом видна в `show`).

Работающего адресата сообщение **по умолчанию не прерывает** (для любого отправителя): оно уходит в идущий ход через
`mid-turn-message` nessy, и агент увидит его между шагами. Когда nessy его принял, а потом ход закончился раньше, чем модель
сообщение забрала (события `mid_turn_message_injected` нет), оно возвращается в очередь и уходит следующим промптом. Не принял
(`accepted:false`, очередь mid-turn полна) — обычная очередь. Ответ хода получает и отправитель вставленного сообщения, если он
не тот же, что у исходного хода (или ждёт `wait`).

`interrupt: true`: текущий ход прерывается (его ожидающий отправитель получает ответ, оканчивающийся на `(ход прерван)`), а сообщение
доставляется **первым**, впереди очереди (несколько срочных — в порядке отправки). Следующий промпт уходит только после подтверждения
отмены от nessy; если его нет за ~3 с, оркестратор продолжает сам и игнорирует поздние события прерванного промпта.

**Закрытие по простою.** Агент, который закончил ход и ничего не ждёт (очередь пуста, запросов разрешения нет), через
`ORCH_IDLE_CLOSE_SEC` (по умолчанию 120 с) «паркуется»: подписка закрывается, сессия nessy закрывается (`DELETE`: слот
`--max-sessions` свободен, контекст остаётся на диске). В `AgentView` это `parked: true`; статус и архив не меняются. Следующее
сообщение поднимает сессию через `POST /session/:id/load` и подписывается с `lastEventId` из ответа (повтор истории не приходит); не
нашлась — создаётся новая, в чате пометка «контекст сброшен». Нет места у демона (503 `session_limit_exceeded`) — агент ждёт `Retry-After`.

## Роли

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/roles` | — | `RoleView[]` (по имени) |
| POST | `/roles` | `RoleRequest {name, instructions, description?, color?, icon?, id?, packageDir?}` | `201 RoleView`; `packageDir` — абсолютный путь к папке пакета роли: копируется в `~/.nessy-orch/role-packages/<id>`, `{{role_dir}}` в инструкциях подменяется путём (`RoleView.package: true`) |
| GET | `/roles/:id` | — | `RoleView`; `:id` — id или имя (без учёта регистра) |
| PUT | `/roles/:id` | `RoleRequest` | `RoleView` (полная замена полей; `id` и `createdAt` не меняются; без `color` цвет прежний) |
| POST | `/roles/:id/package` | — | `RoleView`: заводит роли папку для файлов (`role-packages/<id>`); в ней лежит `role.md` — зеркало роли (frontmatter + инструкции) |
| POST | `/roles/:id/sync` | — | `RoleView`: подхватывает правки `role.md` из папки роли (редактор кода) в роль; без изменений — та же роль; сломанный `role.md` — `400 bad_role_md`, роль прежняя. Правки роли через API/окно «Роли» пишутся в `role.md` |
| DELETE | `/roles/:id` | — | `{ok:true}`; агенты сохраняют `role` (приложение показывает роль удалённой) |

```jsonc
// RoleRequest
{ "name": "Ревьюер",            // обязательно, ≤ 60 символов, уникально без учёта регистра
  "instructions": "…markdown…", // обязательно, ≤ 20000 символов
  "description": "одна строка",  // опционально
  "color": 210,                  // опционально, hue 0..360; по умолчанию — из хеша имени
  "icon": "eye",                 // опционально: имя SF Symbols ([a-z0-9.-], ≤ 40); "" — убрать; при PUT без поля — прежняя
  "id": "reviewer" }             // опционально, только при создании: [a-z0-9-], ≤ 40; по умолчанию — из имени (кириллица транслитерируется: «Ревьюер» → revyuer)
```

Ошибки: `400 bad_request` (поля), `404 no_role`, `409 role_exists` (занят id или имя). Роли хранятся в `<home>/roles.json`.

## Фоновое обучение

Типы — `shared/types/learning.ts`. Не-`GET` маршруты — только оператору (`403 operator_required`). Нет хранилища обучения — `503 learning_unavailable`.

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/learning` | — | `LearningView {settings, jobs[], cases[]}` (кейсы по свежести) |
| PATCH | `/learning/settings` | частичный `LearningSettings` | `LearningSettings`; пишет `<home>/learning.json`, событие `learning_settings`; неверный тип поля — `400 bad_request`, числа ограничиваются |
| POST | `/learning/run` | `{session?}` | `JobView[]`: итоговое задание `close` по сессии или кейсу (`404 no_case`); без `session` — по всем незакрытым кейсам. Работает и при выключенном обучении |
| POST | `/learning/jobs/:id/retry` | — | `JobView`; `404 no_job`, `409 job_not_failed` |
| GET | `/learning/cases/:id` | — | `CaseDetail` = `CaseView` + `summary` (summary.md) и `notes` (notes.md); `404 no_case` |
| DELETE | `/learning/cases/:id` | — | `{ok:true}`; удаляет кейс, `raw/` и его ждущие задания, событие `learning_case_removed`; идёт задание кейса — `409 case_busy`. id корня цепочки и сессий кейса пишутся в надгробие (`<home>/learning/meta.json`, `removed`): кейс сам не воскресает. Вернуть обучение для такой сессии: `PATCH /learning/settings` с `disabledSessions`, где сессия была и перестала быть (`nessy-orch learn off --session S`, затем `learn on --session S`), либо ручной запуск (`POST /learning/run {session}`) / разбор прошлого — они надгробие снимают |
| POST | `/learning/cases/:id/rebuild` | — | `JobView`: сбрасывает `coveredUntil` и `summary.md`, ставит `close`; `409 case_busy` |
| GET | `/learning/backfill` | — | `BackfillCandidate[]` (`kind: session\|transcript`, `id`, `title`, `date`, `size` — сообщений у сессии, байт у транскрипта): сессии без кейса с сообщениями в ленте (сюда попадают и сессии, созданные до первого запуска обучения: живой кейс для них не заводится) и транскрипты Claude Code с вызовами `nessy-orch spawn\|send` (кроме чатов сессий и уже взятых) |
| POST | `/learning/backfill` | `{ids: string[]}` | `BackfillResult {created: CaseView[], skipped: [{id, reason}]}`: кейсы `source:'backfill'` (транскрипт — `c-t-<чат>`), каждому сразу итоговый `close`. Кейс уже есть — `skipped`, не дубль; неизвестный id — `404 no_candidate` (ничего не создаётся) |

### Плейбуки, журнал, заметки, чат

Плейбук — скилл, который обучение собирает из ≥ 3 кейсов одной задачи; статусы `draft → review → trial → active` (и `disabled`, `archived`). Ошибки: `no_playbook` (404), `no_rule` (404), `no_version` (404), `no_journal` (404), `already_reverted`/`not_revertible` (409), `no_edit` (404, правки с таким хэшем в `pendingEdits` нет), `stale_edit` (409, правка больше не применяется к текущему тексту — снимается), `playbook_busy` (409, по плейбуку идёт или ждёт задание, в том числе при принятии правки), `bad_status` (409), `playbooks_unavailable` (503). Типы — `PlaybookView`, `PlaybookDetail`, `JournalEntry`, `ChatMessage`.

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/learning/playbooks` | — | `PlaybookView[]` |
| GET | `/learning/playbooks/:id` | — | `PlaybookDetail` = `PlaybookView` + `notes`, `changelog`, `versions[]`, `reviews[]` (отчёты ревью по версиям) |
| POST | `/learning/playbooks/:id/review` | — | `JobView`: ручной запуск ревью |
| POST | `/learning/playbooks/:id/approve` | — | `PlaybookView`: одобрение → `trial`; `trial.before` — среднее число поправок на кейс до плейбука |
| POST | `/learning/playbooks/:id/reject` | `{reason?}` | `PlaybookView`: плейбук `disabled`, причина в журнале |
| POST | `/learning/playbooks/:id/status` | `{status}` | `PlaybookView`; `status` — `active`, `disabled` или `archived` (иначе `400`) |
| POST | `/learning/playbooks/:id/revert` | `{version}` | `PlaybookView`: файлы версии `version` новой версией, статус остаётся |
| POST | `/learning/playbooks/:id/edits/:hash/accept` | — | `PlaybookView`: принять правку из `pendingEdits` (`autoReview: false`) — применяется к текущему состоянию, новая версия, запись журнала `edit` |
| POST | `/learning/playbooks/:id/edits/:hash/reject` | — | `PlaybookView`: отклонить правку — снимается из `pendingEdits`, хэш уходит в `rejectedEdits` |
| DELETE | `/learning/playbooks/:id` | — | `{ok:true}`; идёт или ждёт задание плейбука — `409 playbook_busy` |
| PUT | `/learning/playbooks/:id/notes` · `/learning/cases/:id/notes` | `{text}` | `{ok:true}`: заметки пользователя (`notes.md`); автоматически не переписываются, уходят следующим сборщикам, судьям и ревьюерам объекта |
| GET | `/learning/journal?limit=` | — | `JournalEntry[]` (старые первыми): каждое автоматическое решение с отчётом |
| POST | `/learning/journal/:id/revert` | — | `JournalEntry` (запись `reverted`): откат статуса, правила или версии; повторный — `409 already_reverted` |
| GET | `/learning/chat/:subject` | — | `ChatMessage[]` чата кейса (`c-…`) или плейбука (`p-…`); `?limit=` |
| POST | `/learning/chat/:subject` | `{text}` | `ChatMessage` (сообщение пользователя); ставится задание `edit:<subject>`, агент-редактор отвечает ещё одним `ChatMessage`. У кейса меняется только `summary.md`; у плейбука — поля плейбука, выходит новая версия (журнал `edit`). Постоянная инструкция («всегда проверяй X») дописывается в `notes.md` строкой `- <дата>: <текст>` |
| POST | `/learning/hint` | `{session, prompt}` | `{playbook: {id, skill, title} \| null}`: подсказка плейбука для хука UserPromptSubmit. Подсказываются только `trial`/`active`, один раз на цепочку сессий и не уже загруженный кейсу. Приоритет: подсказка сборщика (в кейсе появилась цель с типом = `taskType` плейбука), затем BM25 по тексту запроса и целям кейса, порог `HINT_MIN_SCORE = 2.5` (индекс добит пустыми документами до 10, чтобы оценка не зависела от числа плейбуков). `skill` = `nessy-playbooks:<id>`. Обучение недоступно или выключено — `{playbook: null}`; нет `session`/`prompt` (строки) — `400 bad_request`. Подсказанное запоминается в `CaseState.hinted` (переживает рестарт) |

Новые события `GET /stream`: `learning_playbook` (upsert `PlaybookView`), `learning_playbook_removed`, `learning_journal`, `learning_chat` (`subject`, `message`). Активные плейбуки (`trial`, `active`) публикуются как плагин `nessy-playbooks` (`ORCH_PLAYBOOKS_PLUGIN_DIR`, по умолчанию `~/.claude/skills/nessy-playbooks`). Ответы агентов не-кейсовых заданий лежат в `<home>/learning/runs/<объект>/<задание>-<k>.md`, кейсовых — в `cases/<id>/runs/`.

События `GET /stream`: `{"t":"learning_case","rev":…,"case":CaseView}` (upsert),
`{"t":"learning_case_removed","rev":…,"id"}`, `{"t":"learning_job","rev":…,"job":JobView}` (upsert), `{"t":"learning_settings","rev":…,"settings":LearningSettings}`.
Служебная сессия `background` (агенты-сборщики) в списки и снапшот не попадает.

## Сообщения

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/messages?agent=&since=&limit=200` | `Message[]` по возрастанию `seq`; `agent` — все сообщения, где он отправитель или получатель; `since` — только `seq > since` |

## Потоки (SSE)

Заголовки ответа: `Content-Type: text/event-stream; charset=utf-8`. Сразу после открытия — комментарий `: connected`, затем
каждые 15 с — `: hb`. **Кадры без поля `event:`** — только `data: <json>` (в `/stream` снапшот ещё несёт `id: <rev>`).

### `GET /stream` — граф и общая лента

Первый кадр — снапшот, дальше изменения (`StreamEvent`):

```jsonc
{"t":"snapshot","rev":42,"spaces":[…],"agents":[…],"roles":[…],"sessions":[…],"messages":[…последние 300…]}
{"t":"message","rev":43,"message":{…}}
{"t":"agent","rev":44,"agent":{…}}           // upsert узла (статус, очередь, превью, права…)
{"t":"agent_removed","rev":45,"id":"a-7f3k"}
{"t":"space","rev":46,"space":{…}}           // upsert
{"t":"space_removed","rev":47,"name":"main"}
{"t":"role","rev":48,"role":{…}}             // upsert роли
{"t":"role_removed","rev":49,"id":"reviewer"}
{"t":"session","rev":50,"session":{…SessionView}}
{"t":"session_removed","rev":51,"id":"fix-ci-3f2a"}
{"t":"learning_case","rev":52,"case":{…CaseView}}   // также learning_case_removed, learning_job, learning_settings — см. «Фоновое обучение»
```

Правила клиента: при **каждом (пере)подключении** приходит новый `snapshot` — состояние заменяется целиком. События чата
агентов и чанки в `/stream` **не** идут.

### `GET /agents/:ref/stream` — чат агента

Порядок: реплей до 400 последних `AgentEvent` (**без** незавершённого блока) → если есть незавершённый живой блок
`text|thought`, он приходит **одним** `chunk` (`delta` = весь накопленный текст, `len` = его длина) → `{"t":"agent",…}` →
`{"t":"replay_done"}` → живые кадры (`AgentStreamEvent`). Неизвестный агент → `404 no_agent` (обычный JSON-ответ, не SSE).

```jsonc
{"t":"event","event":{"seq":12,"ts":…,"kind":"user","from":"you","msgId":"m-…","text":"…"}}
{"t":"chunk","chunk":{"seq":13,"ts":…,"kind":"text","delta":"при","len":3}}   // дельта живого блока text|thought
{"t":"event","event":{"seq":13,"ts":…,"kind":"text","text":"привет"}}          // итог блока (тот же seq)
{"t":"event","event":{"seq":14,"kind":"tool","toolId":"…","name":"run_shell_command","title":"…","input":{…},"status":"in_progress"}}   // status: pending | in_progress | completed | failed
{"t":"event","event":{"seq":14,"kind":"tool",…,"status":"completed","output":"…"}}   // обновление — тот же seq
{"t":"event","event":{"seq":15,"kind":"permission","requestId":"…","title":"…","resolved":false}}   // решённый: resolved:true, approved, auto
{"t":"event","event":{"seq":16,"kind":"system","level":"info","text":"…"}}                             // level: info | error
{"t":"agent","agent":{…}}
```

**Правило слияния:** событие с уже виденным `seq` **заменяет** прежнее. `chunk` дописывает `delta` к живому блоку с этим
`seq` (создать, если нет; для блока из снапшота `delta` — весь текст сразу); последующий `event` с тем же `seq` фиксирует
итоговый текст. Блок закрывается при смене вида/`messageId`, вызове инструмента или конце хода. При переподключении реплей
приходит заново — буфер очищать.

## Примеры (curl)

```sh
curl -s localhost:4337/status
curl -s -XPOST localhost:4337/spaces -d '{"path":"/Users/me/Projects/shippy"}'
curl -s -XPOST localhost:4337/agents -d '{"space":"shippy","name":"rev","prompt":"что в README?","wait":true}'
curl -s -XPOST localhost:4337/agents/rev/send -d '{"text":"а в CHANGELOG?"}'              # прервёт текущий ход
curl -s -XPOST localhost:4337/agents/rev/send -d '{"text":"и ещё"}'      # дойдёт в идущий ход, не прерывая
curl -s -XPOST localhost:4337/roles -d '{"name":"Ревьюер","instructions":"Смотри MR строго"}'
curl -s -XPOST localhost:4337/agents -d '{"space":"shippy","role":"revyuer","prompt":"MR !12"}'
curl -s 'localhost:4337/agents/rev/wait?timeout=60'
curl -sN localhost:4337/stream
```
