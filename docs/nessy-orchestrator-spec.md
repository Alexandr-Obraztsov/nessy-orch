# Оркестратор для nessy: варианты архитектуры и спека правок ядра nessy-orch

Источник фактов: 17 агентов + 2 верификатора с живым демоном `nessy serve` (2026-10-10).
Рантайм: `nestor/nessy-cli`, master `f389c98`, локально `0.13.15`.

## 1. Главный вывод про интеграцию

**In-process библиотеки у nessy нет.** Пакет `@nestor/nessy-cli` — только `bin`, без `exports`/`main`.
Официальный `@nestor/nessy-cli-sdk@0.8.6` — обёртка: `query()` спавнит CLI через `child_process`,
`DaemonClient`/`DaemonSessionClient` ходят HTTP+SSE к живому демону. Как рантайм-зависимость SDK
**отклонён** (причины — §2, вывод по отчёту агента `nessy-sdk`, §7). Сам nessy в справке `--http-bridge`
пишет: «Stage 2 native in-process mode is not yet implemented».

Значит выбор — не «serve или библиотека», а **как подключиться к serve**.

## 2. Сравнение вариантов

| # | Вариант | Зрелость | Плюсы | Минусы | Вердикт |
|---|---|---|---|---|---|
| A | serve-субпроцесс + raw HTTP/SSE (текущий) | Stage 1 experimental | полный контроль, ноль зависимостей, 1 демон на воркспейс | свой SSE-парсер, свой ретрай, хрупко к смене протокола | **база** |
| B | serve + SDK `DaemonClient` | experimental 0.8.x | типы, подтверждает каноничность кадра `turn_error` | ~62 МБ unpacked (dist ~61 МБ), тащит `zod` + `@modelcontextprotocol/sdk`, peerDep `typescript>=5`/`Node>=22`, 0 вхождений 429 / нет `Retry-After` (P0 не закрывает), SSE без auto-reconnect, 0.8.x churn | **отклонён** |
| C | serve как MCP-мост (`nessy-serve-mcp`) | официальный | любой MCP-клиент управляет nessy | лишний слой, MCP-tool `prompt` блокирует ответ | опция |
| D | headless CLI `nessy -p -o stream-json` | зрелый | просто, детерминированно, exit 55 | нет общей сессии, один запуск на процесс | для разовых задач / CI |
| E | ACP-over-HTTP `/acp` (JSON-RPC 2.0) | эксперимент | стандартный протокол | нужен ACP-клиент | опция |
| F | true in-process | не существует | — | форк nessy, необратимо | **отклонён** |

**Рекомендация:** остаться на serve-субпроцессе (A) и собственном HTTP/SSE-клиенте, закрыть P0 локально
(разбор `turn_error` в `event-mapper.ts` + различение 429/503/`Retry-After` в `nessy-client.ts`); SDK (B)
не брать рантайм-зависимостью (см. §7); headless CLI (D) держать для разовых задач. Схема — «фасад +
координатор» над пулом демонов.

## 3. Покрытие ролей — ключевая находка

Роль оркестратора 1:1 ложится на **нативного субагента nessy** (проверено живым демоном):

| Поле роли nessy-orch | Механизм nessy | Применение |
|---|---|---|
| `name` | субагент `name` | 2–64 симв., Unicode `[\p{L}\p{N}_-]` |
| `description` | субагент `description` | показ в `/agents` |
| `instructions` | **тело `.md`** = `systemPrompt` | нативный промпт, без preamble-хака |
| `color` | субагент `color` | нативно |
| — | `disallowedTools[]` | доступ к инструментам |
| — | `approvalMode` | `plan/default/auto-edit/auto/yolo` |
| — | `model` / `modelConfig` / `runConfig` | своя модель, лимиты хода |

Файл: `<space>/.nessy/agents/<id>.md`, frontmatter + тело. Уровни: `session/project/user/extension/builtin`.

**HTTP (работает на лету, без рестарта; все мутирующие запросы требуют bearer-token, иначе 401 `token_required`):**
- `GET /workspace/agents`, `GET /workspace/agents/:name`
- `POST /workspace/agents` — create (201; повтор → 409 `agent_already_exists`); тело требует `scope`
  (`workspace`/`global`) и поле инструкций называется `systemPrompt`
- `POST /workspace/agents/:agentType` — **update (200)**; `PUT/PATCH` → 404
- `DELETE /workspace/agents/:name` → 204
- событие `agent_changed`

**Чего нельзя:** `POST /session` **игнорирует** `agents`/`systemPrompt`/`mcpServers` — роль не прокинуть
телом сессии, только через воркспейс/каталог. Скиллы по HTTP — только чтение.

## 4. Покрытие MCP

17 серверов (`nessy-default-extension` v1.0.20), **231 инструмент**, имена `mcp__<server>__<tool>`.
Крупные: `t-tracker` 42, `dpAllure` 41, `time` 38, `dpFinedog` 28, `dpJira` 18, `dpGitlab` 11,
`diameter` 10, `whiteboard` 9, `dpWiki` 8, `dpMail` 6, `dpSage` 5, `meetings` 5, `codeSearch` 4.

Управление по HTTP есть: `GET /workspace/mcp`, `POST /workspace/mcp/servers` (тело `{name,config}`),
`DELETE /workspace/mcp/servers`, `POST /workspace/mcp/:server/restart` — требуют `X-Nessy-Client-Id`.

Ограничения:
- `EXTERNAL_MODEL_MCP_WHITELIST` = {dpJira, dpGitlab, dpWiki, t-tracker, dpFinedog, dpSage, dpAllure, context7}
  — **внешним моделям видны только 8 серверов**, остальные 9 заблокированы.
- `autoApprove` в `mcpServers` **не поддерживается** — рычаги `permissions.allow/deny`, `trust`, `readOnlyHint`.
- Вызвать dp-инструмент снаружи сессии нельзя — только моделью внутри.

## 5. Ограничения демона (обязательный чек-лист)

| Ограничение | Следствие для оркестратора |
|---|---|
| 1 демон = 1 воркспейс | мультиворкспейс — пул демонов + роутинг |
| `--max-sessions 20`, `--max-connections 256`, SSE cap 64 | планировщик снаружи |
| FIFO `promptQueue`, `--max-pending-prompts-per-session 5` | любой промпт (в т.ч. первый) → 202 `{promptId}`; переполнение → 503 `prompt_queue_full` |
| `sessionScope` по умолчанию `single` (общая сессия на воркспейс) | для изоляции агентов — `thread` |
| сессии in-memory, эфемерны | `load` (replay) / `resume` (watermark); durable-state — на оркестраторе |
| rate-limit **выключен по умолчанию**; при включении 429 + `Retry-After` | backoff строит оркестратор |
| permission-политика **глобальная**, таймаут 5 мин | shared bearer → голос в любую сессию |
| голос — **вложенный** `{outcome:{outcome:'selected',optionId}}` | плоское тело → 400 |
| агент = тот же UID, **не песочница** | не запускать под аккаунтом с секретами |
| нет Prometheus, аудит in-memory | метрики/аудит собирать из SSE |
| `unstable_*` меняют форму без bump | читать `GET /capabilities` перед стартом |

`/capabilities` → `v:1, protocolVersions{v1}, mode, features(62), modelServices[], workspaceCwd, policy`.

## 6. Спека правок ядра nessy-orch

Ядро уже развязано: бэкенд за портом `NessyGateway` (`src/application/ports.ts`), протокол изолирован
в `src/infrastructure/nessy/`. Замена рантайма = новый класс + `src/app.ts`.

**P0 — корректность протокола** (баги, подтверждённые верификатором):
1. `src/infrastructure/nessy/event-mapper.ts` — **не обрабатывает `turn_error`** как отдельный кадр
   (switch → default null). Ошибки промпта теряются: вложенный `_meta.nessy/error` в живом потоке не
   приходит. Добавить разбор `turn_error{message,code,promptId}`. *Примечание: то, что `turn_error`
   приходит отдельным топ-левел кадром, подтверждено кодом рантайма (`broadcastTurnError`,
   `TURN_BOUNDARY_TYPES`), живьём воспроизвести кадр не удалось.*
2. `src/infrastructure/nessy/nessy-client.ts` — `request()` не читает `Retry-After`; `ok()` не различает
   429/503 (все → 502). Различать `prompt_queue_full` (503), `session_busy` (409), 429.
3. Согласовать отмену: док обещает `stopReason:'cancelled'`; живьём (0.13.15) при `POST /session/:id/cancel`
   → 204 и в SSE приходят `prompt_cancelled`, дальше — **либо** `turn_complete{stopReason:'cancelled'}`,
   **либо** `turn_error` — зависит от сценария отмены. Сообщение `"Request was aborted"` относится к abort
   на уровне модели/клиента (`APIUserAbortError`), а не к обычной отмене. Сам P0-баг (маппер не разбирает
   `turn_error`) остаётся валидным независимо от этого.

**P1 — нативные роли:**
4. Заменить вставку роли текстом в preamble (`src/domain/preamble.ts:9`) на субагентов:
   создать/обновлять роль через `POST /workspace/agents` + файл `<space>/.nessy/agents/<id>.md`
   (тело = instructions). При смене роли — `POST /workspace/agents/:agentType` (на лету).
   Динамические вставки (peers, формат статуса) переносить в тело.

**P2 — протокол и клиент:**
5. Формализовать разбор 43 типов SSE-событий (`session_update`, `permission_*`, `turn_complete/error`,
   `state_resync_required`, `replay_complete`, `mcp_*`, `settings_changed`).
6. ~~Перейти на SDK `DaemonClient`~~ — **отклонено** (см. §2): SDK не закрывает 429/`Retry-After`, тяжёлый
   (~62 МБ), SSE без auto-reconnect, нарушает принцип «без рантайм-зависимостей». Остаёмся на своём
   клиенте; у SDK взять только канон формы `turn_error` для сверки нашего P0.

**P3 — координация (то, чего нет ни у кого из существующих клиентов):**
7. Роутинг воркспейс→демон: пул `nessy serve`, по одному на воркспейс, супервизия процессов.
8. retry/backoff/очередь: обрабатывать 503 `prompt_queue_full`, FIFO, 429 с `Retry-After`,
   `NESSY_CLI_UNATTENDED_RETRY`.
9. Метрики и аудит из SSE (демон их не хранит): токены из `GET /session/:id/stats` +
   `~/.nessy/usage/token-usage-YYYY-MM.jsonl`.
10. Парсить статусы `DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED` программно (сейчас — текст в промпте).

**P4 — покрытие возможностей:**
11. Экспонировать в UI/CLI управление MCP-серверами (`/workspace/mcp/servers`) и просмотр списка
    инструментов (`/session/:id/context`).
12. Скиллы — подтягивать в тело роли (по HTTP только чтение).

## 7. Открытые вопросы
- Числовые серверные квоты (`active_user_pool`, пиковые 429 12–19) — агентам закрыт Wiki/Sage.
- «Увидит ли живая сессия нового агента при спавне» — подтверждено чтением с диска и событием
  `agent_changed`, не реальным запуском субагента.
- Версию контракта фиксировать по факту сборки: доки противоречивы насчёт `load`/`resume` в Stage 1.
- Не подтверждено из кода рантайма (взято из живых отчётов): счётчики MCP «17 серверов / 231
  инструмент» и разбивка по серверам, `features(62)` в `/capabilities`, число «43 типов SSE-событий»,
  «агент = тот же UID, не песочница», «нет Prometheus / аудит in-memory».
- Канонический репозиторий `nestor/nessy` (и исходники `nessy-cli` по master `f389c98`) недоступен
  (404 / нет доступа по SSH) — SDK `@nestor/nessy-cli-sdk@0.8.6` и его `query()`/`child_process` оценены
  агентом `nessy-sdk` по npm-тарболу, а не по исходникам; сверка спеки велась по локальному рантайму
  `0.13.15` (скомпилированный бандл), а не по исходникам master.
