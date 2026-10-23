# AgentPort: новое ядро nessy-orch — дизайн

Дата: 2026-10-23. Статус: черновик. Область: ядро оркестратора и рантайм-адаптеры.

## 1. Цель и рамки

Эволюция nessy-orch: ядро перестаёт знать протокол nessy и работает с любым агентом через единый порт
`AgentPort`. Сегодня дерево оркестраторов строится на двух рантаймах:

- **nessy** (SDK, встроенный) — исполнители-агенты с малым окном контекста;
- **tclaude** (Claude Code, локально) — главный агент.

Принципы:

- ядро **не делает прямых LLM-вызовов** — только управляет агентами через порт;
- удалённые рантаймы (A2A/Qwarium) — этап 2, но контракт закладывает маппинг заранее;
- появляется **новый CLI** как один из фронтендов к ядру.

Рассмотрены open-source оркестраторы (claude-squad, cli-agent-orchestrator, agent-orchestrator, Orca, Emdash,
MS Conductor): форк отклонён (tmux-scraping вместо структурированных событий, UI-центричность, нет программной
рекурсии); заимствованы два паттерна — worktree-изоляция (§12) и конфиг-как-код (§7).

## 2. Архитектура слоёв

Слои идут от ядра наружу, зависимости направлены внутрь:

```
ядра (Orchestrator, Agent, AgentRun)
  → порты (AgentPort, StorePort, Clock, Ids)
  → рантайм-адаптеры (NessyServe, NessySdk, Tclaude)
      └─ сессии/процессы агентов
  → интерфейсы (HTTP/SSE, CLI, OrchestratorTool)
```

`Agent` — единица работы, отделена от бэкенд-сессии: сессия представлена хэндлом `AgentRun`. Дерево
оркестраторов — `Registry`/`Feed`/`Hub`/`services` (существующие, без переписывания).

## 3. Контракт AgentPort

Слияние `NessyGateway` + `SessionEvent` в один порт.

**Операции:** `session.create`, `session.resume`, `prompt.send`, `prompt.cancel`, `permission.vote`,
`model.set`, `mid_turn.send`, `session.close`.

Отдельной операции `interrupt` нет: отмена хода — это `prompt.cancel`, реализуемая per-runtime: serve —
`POST /session/:id/cancel`; SDK — `interrupt()`; tclaude — `SIGINT` с игнором позднего `result`.

**Конверт Envelope:**

```jsonc
{ "v": 1, "sessionId": null, "seq": 0, "ts": 0, "originatorClientId": null, "type": "", "data": {} }
```

**Обязательные события ядра (11):** `session.ready`, `turn.started`, `message.delta`, `message.completed`,
`tool_call.started`, `tool_call.completed`, `turn.completed`, `turn.failed`, `turn.cancelled`, `error`,
`session.closed`.

Правило происхождения: события обязаны прийти через порт, но не обязаны быть нативными — адаптер вправе
синтезировать их из собственных действий: отправка промпта → `turn.started`; конец хода с текстом →
`message.completed`; готовность/закрытие сессии → `session.ready`/`session.closed`.

**Опциональные (10):** `permission.requested`, `permission.resolved`, `tool_call.delta`, `thought.delta`,
`plan.updated`, `model.switched`, `model.switch_failed`, `mid_turn.injected`, `context.usage`,
`user_message.delta`.

`plan.updated` и `tool_call.delta` остаются контрактными строками, но в P0–P3 адаптерами не реализуются.

**Capability-флаги (4):** `streamText`, `midTurn`, `permissionVote`, `setModel`. Остальные возможности
выводятся из фактических событий/операций, а не декларируются заранее. `replay` и `nonBlockingPrompt` —
целиком на этап 2 (A2A). Если UI понадобится превентивное знание о `rawOutput` — вернуть точечно.

Правило верификации модели: адаптер **не доверяет** опции/флагу модели — сверяет фактическую модель из
`system/init`. Подтверждено на обоих рантаймах: nessy SDK модель-опция молча фолбэчится; tclaude `--model opus`
молча падает в дефолт. При расхождении — событие `model.switch_failed` или ошибка спавна.

**Минимальный адаптер:** 4 операции (`session.create`, `prompt.send`, `prompt.cancel`, `session.close`) +
обязательные события.

**UnifiedUsage:**

```jsonc
{
  "inputTokens": 0, "outputTokens": 0,
  "totalTokens": null, "costUsd": null, "numTurns": 0, "durationMs": null
}
```

`perModel`, `cacheReadInputTokens`/`cacheCreationInputTokens`, `durationApiMs` — добавить при появлении
потребителя (этап 2, модель-политика).

**Маппинг в A2A v1.0 (этап 2):** `prompt.send` → `task/send`; ход → жизненный цикл Task
(`submitted/working/completed/failed/canceled/input-required`); текст → `Part{text}`; вызов/результат
инструмента → `Part{function-call/function-response}`; `rawOutput` → `Artifact`; `permission.*` /
`mid_turn.*` — extensions (спецификация A2A v1.0).

## 4. Ядро

Принцип **«детерминированный контроль-плейн»** (заимствован у MS Conductor — «orchestration consumes zero
tokens»): ядро не содержит LLM-вызовов, все решения оркестрации — обычный код; вся интеллектуальность — в
агентах. Согласуется с рамкой «без прямых LLM-вызовов из ядра» (§1).

- `AgentSpec { runtime, role, model, cwd, tools, mcp }` — декларация агента.
- `Agent` — единица работы; отделена от бэкенд-сессии, которая живёт в хэндле `AgentRun`.
- `Orchestrator` — существующие `registry`/`feed`/`hub`/`services`, без переписывания.
- **`RuntimePool`** — тёплые хэндлы per-runtime (обобщение `SessionPool`; переменная `ORCH_WARM_SESSIONS`,
  `load-config.ts:46`). На P0 `SessionPool` не трогается; обобщение до `RuntimePool` — на P1/P2, к появлению
  второго тёплого рантайма.
- **`AgentCallbacks`** — интерфейс обратных вызовов. Интерфейс `AgentHost` уже чистый (`agent.types.ts:8-25`);
  рефакторится его реализация — `Orchestrator` (`orchestrator.ts:72 implements AgentHost`): выделить
  `AgentCallbacks` без цикла `agent → host → agent`.
- **Буфер инструментов по `toolCallId`** — внутри адаптера, не в ядре.

## 5. Суб-оркестраторы

Программный **`OrchestratorTool`** — in-process API для агентов; CLI — один из фронтендов к тому же API.
Бюджет глубины/активности — существующий: `maxDepth`, `maxActivePerSession`, `hops`.

## 6. Адаптеры

**(а) NessyServe** — миграция существующих `nessy-client.ts` + `event-mapper.ts` + `serve-space.ts` под
`AgentPort`; путь отката при проблемах с новыми адаптерами. Декларируется `setModel=false`: в `NessyGateway`
операции смены модели нет (`ports.ts:31-63`); `model.set` доступен только `NessySdk` и `Tclaude`. Только
токен-лимиты: `parseStats` даёт input/output/cached/total (`usage.ts:13-22`).

**(б) NessySdk** — `@nestor/nessy-cli-sdk 0.8.6` (последняя опубликованная; клон 0.8.7-preview.0 не
опубликован — работать с 0.8.6 до выхода стабильной). Процесс на сессию; `query()`/`canUseTool`/`setModel`.
Убирает 10-секундный хардкод (`acp-bridge` `bridge.ts:655`) и `ServeSpace`. Прямого mid-turn в канале нет —
только serve-путь (`DaemonSessionClient:397`).

Факты живого спайка (`spike-nessy-sdk/`):

- холодный старт до `system/init` **2.7–3.7с** (внешняя оценка 18–39с относилась к другому пути) — тёплый пул
  менее критичен; RSS CLI-процесса ~240 МБ — главный ограничитель размера пула (влияет на `ORCH_WARM_SESSIONS`
  по умолчанию);
- `interrupt()` **грязный**: CLI-процесс умирает с кодом 130 (SIGINT), в поток приходит ошибка
  `CLI process exited with code 130`, `result`-события нет, `isClosed()` = false. Правило адаптера: ловить
  exit-130 → синтезировать `turn.cancelled` → принудительно закрывать хэндл;
- `canUseTool` вызывается только для инструментов, требующих подтверждения (read-only автоодобрены) — модель
  прав адаптера учитывает auto-approved класс; сигнатура `(toolName, input, ctx)`, возврат
  `{behavior:'allow', updatedInput}` реально применяется;
- параллельные `query()` подтверждены (2 одновременно, ~6.6с) — база тёплого пула;
- события короткого хода: `system/init` → `assistant` → `result`; `stream_event` (partial) — только при
  `includePartialMessages:true`.

**(в) Tclaude** — чистый `child_process`, без зависимостей (доказано спайком `spike-tclaude/spike.js`):
`-p --output-format stream-json`, `--model`, `--session-id`/`--resume`; параллельность 3; завершение
`SIGINT`/`SIGKILL`. Обязательные меры:

- **верификация модели** по `system/init` — модель `opus` молча падает в `zai/glm`;
- **игнор позднего `result`** после отмены (гонка `SIGINT`);
- **изоляция** — `--bare`, фейковый `HOME`, `--strict-mcp-config`, `--no-session-persistence`;
- стоимость `sonnet` ≈ `/bin/zsh`/0.42 $/ход.

## 7. Точки расширения

**Сразу:**

- рантайм-адаптеры — публичный API `AgentPort`;
- роли/скиллы — Claude-совместимый frontmatter `SKILL.md`, существующие role-packages (лимиты: 500 файлов /
  20 МБ);
- хуки жизненного цикла — на старте только событийная шина `hub`; command/http/prompt-хуки — фасады поверх,
  добавить при появлении внешнего потребителя (по образцу `hookSystem` в nessy-cli);
- `StorePort`;
- конфиг: env + файл + per-project override;
- **конфиг-как-код** (по образцу конфигов Orca) — декларативные пресеты сборок агентов: роль + модель +
  рантайм + тулы в одном файле.

**Отложено (YAGNI):** модель-политика как плагин, каналы, `outputStyles`, LSP, `userConfig`.

## 8. Новый CLI

- дерево оркестраторов (tree-вывод);
- `--runtime` у `spawn`, модель в спавне;
- рекурсивные команды `send`/`spawn`/`plan` сохраняются с `--from`/`--key`.

## 9. Ошибки и деградация

- `turn.failed{retryable}` — флаг повтора;
- аккуратная деградация по capability-флагам;
- лимиты бюджета хода (`costUsd`/`numTurns`) — только для рантаймов, отдающих эти метрики (tclaude `result`,
  SDK usage); для `NessyServe` — только токен-лимиты (`parseStats`: input/output/cached/total, `usage.ts:13-22`);
  оценка стоимости — опция, не требование;
- retry с экспоненциальной паузой (существующий план).

## 10. Тестирование

- **conformance-сьют `AgentPort`** — общий для всех адаптеров, каждый обязан пройти; сьют требует события,
  но не их нативного происхождения — допускается синтез адаптером из собственных действий (§3);
- **fake-адаптер** для ядра (развитие `fake-nessy`);
- unit-тесты мапперов;
- e2e-смоуки — спайк tclaude как основа.

## 11. План миграции

- **P0** — контракт-рефакторинг без изменения поведения: слияние портов, `AgentCallbacks`, serve-адаптер,
  все тесты зелёные, откат тривиален;
- **P1** — сначала верификация API-поверхности SDK живым импортом `@nestor/nessy-cli-sdk` (пиннинг 0.8.6,
  спайк `spike-nessy-sdk/` выполнен), затем адаптер `NessySdk` + выбор рантайма per-space/agent; обобщение
  `SessionPool` → `RuntimePool` (риск дублирования тёплых пулов serve-SessionPool и NessySdk-пула — развести
  намеренно, один механизм к P1);
- **P2** — адаптер `Tclaude` + модель на агенте;
- **P3** — новый CLI;
- **P4** (этап 2) — A2A-адаптер и Qwarium-раннер (маппинг 1-в-1 уже заложен в §3).

## 12. Риски и снятия

| Риск | Снятие |
|---|---|
| SDK экспериментальный | пиннинг + serve-адаптер как путь отката |
| SPOF-контракт | версионирование `Envelope v:1` + conformance-тесты |
| стоимость tclaude | лимиты + дешёвые модели по умолчанию |
| вложенная песочница tclaude не применяется | изоляция — задача ядра: `cwd` на агента |
| параллельная работа над одним репозиторием | worktree-изоляция на агента как опция `AgentSpec`/пространства (не обязательна: агенты часто работают в разных каталогах); заимствовано из open-source (у каждого агента свой worktree/ветка) |

## 13. Открытые вопросы

**Решено — связь агентов:** все сообщения агент↔агент идут только через ядро (`OrchestratorTool` / язык
`send`/`spawn`/`wait`); P2P-механизмы рантаймов не используются. Обоснование: (а) единая лента событий и
трассировка — диагностика в одном месте, одно из ключевых преимуществ варианта B из арены; (б) единый
бюджет/лимиты/права на все коммуникации; (в) одинаковая семантика для всех рантаймов — nessy P2P не умеет,
единообразие вместо «tclaude болтает напрямую, nessy через ядро»; (г) аудит. У tclaude ≥2.1.224 есть нативный
cross-session messaging (ListAgents/SendMessage, Unix-сокет) — фича сознательно **не** задействуется для
межагентной связи; пересмотреть в будущем при появлении сценария (например, деградация ядра).

Открытые:

- политика прав tclaude-адаптера: в headless permissions настраиваются `--permission-mode` (спайк использовал
  `bypassPermissions`) + `allowlist`; `autoApprove` неприменим;
- форма `OrchestratorTool` для in-process агентов;
- миграция персистентности (legacy `task` → `session`);
- **поздняя подписка/resume теряет синтезированные события** (§3): синтезированные `session.ready`/`turn.started`
  (и `message.completed`) не имеют транспортного id и не воспроизводятся при `session.resume`/поздней `subscribe`
  — потребитель, подписанный после постановки промпта, не увидит `turn.started`. Требуется буфер синтезированных
  событий (по adapter-seq) или запрет поздней подписки на середину хода; решение — на P1.