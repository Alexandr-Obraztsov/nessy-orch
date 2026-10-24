# Адаптер tclaude (TclaudeAgentPort)

Адаптер `AgentPort` поверх headless tclaude CLI (child_process + stream-json).
Реализация — `agent-port-tclaude.ts`, спавн/аргументы — `spawn-claude.ts`, состояние и маппинг —
`tclaude-session.ts`.

## Что делает

- **Сессия = живой процесс** `tclaude -p --output-format stream-json --input-format stream-json --verbose
  --bare --strict-mcp-config --no-session-persistence --permission-mode <mode>`. `--verbose` обязателен:
  без него `-p` + stream-json не эмитит события. `--model` и `--session-id` задаются только при спавне.
- **Изоляция:** чистый `HOME` (временный каталог) на агента, `cwd` — воркспейс агента. Временный HOME
  удаляется в `sessionClose`/`closeAll` (нет утечки каталогов).
- **Auth llm-прокси:** изолированный HOME не содержит auth-конфига, поэтому токен берётся так же, как это
  делает сам tclaude — из `apiKeyHelper` реального `~/.claude/settings.json` (`defaultResolveAuth`) — и
  прокидывается в env ребёнка (`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL`). Токен живёт только в env
  процесса, не логируется и не пишется в файлы. Уже заданный в env токен не перезаписывается.
- **Маппинг NDJSON → Envelope:** `system/init` → верификация модели; `stream_event` (text_delta) и
  `assistant` → `message.delta`; `result` → `message.completed` + `turn.completed` с `UnifiedUsage`
  (доступен через `sessionUsage()`); `error` → `turn.failed`; обрыв процесса → `turn.failed`.
- **Операции:** `session.create` (спавн), `session.resume` (`--resume`), `prompt.send` (запись в stdin),
  `prompt.cancel` (SIGINT), `session.close` (SIGINT, затем SIGKILL при зависании), `model.set` (рестарт с
  новой `--model`), `mid_turn.send` (открытый stdin).
- **Многоходовость:** после `result` процесс `-p` завершается; `prompt.send` на следующий ход детектит
  мёртвого ребёнка и переподнимает его с `--resume` (контекст сохраняется). События старого процесса
  после рестарта (resume/model.set) игнорируются — не текут в новый ход.
- **Дренаж stderr:** поток ребёнка дренируется; ограниченный хвост (64 КБ) хранится в `stderrTail`
  сессии для диагностики.

## Ограничения из спайка (spike-tclaude)

- **Стоимость:** каждый ход tclaude тратит бюджет (sonnet ~0.42 $/ход, opus дороже). Интеграционные
  conformance/live-тесты за флагом `ORCH_E2E_TCLAUDE=1`, по умолчанию выключены — включать осознанно.
- **`--bare`** обязателен: без него tclaude поднимает интерактивный TUI, ломающий `stream-json`.
- **Фейковый HOME:** чтобы не смешивать агентов и не трогать пользовательский `~/.claude`, каждый агент
  получает временный каталог (и auth через `apiKeyHelper`-инъекцию, см. выше).
- **SIGINT-гонка:** при отмене процесс может успеть прислать поздний `result`. Адаптер помечает ход
  отменённым и игнорирует поздние `assistant`/`stream_event`/`result`, синтезируя `turn.cancelled`.
- **Верификация модели:** `--model opus` молча падает в дефолт рантайма. Адаптер не доверяет флагу:
  сверяет фактическую модель из `system/init` и при расхождении эмитит `model.switch_failed`.
- **Permissions:** спайк использовал `bypassPermissions`. В адаптере вместо этого `--permission-mode` из
  конфига, безопасный дефолт — `default` (штатные подтверждения). `permissionVote=false`.
- **`--no-session-persistence`:** персистентность сессий не используется; `session.resume` поднимает живой
  процесс, для закрытых сессий возвращает `null`.

## Интеграция в фабрику

Адаптер подключён: `src/infrastructure/process/tclaude-space.ts` (`TclaudeSpace`) создаёт
`TclaudeAgentPort` для пространств с `runtime: 'tclaude'`; фабрика в `src/app.ts` выбирает рантайм
пространства по `init.runtime` (tclaude vs nessy-sdk). Конфиг: путь к бинарю — `TCLAUDE_PATH` (дефолт
`tclaude`), модель — `ORCH_TCLAUDE_MODEL`, режим разрешений — `ORCH_TCLAUDE_PERMISSION_MODE` (дефолт
`default`). Рантайм/модель пространства видны в `SpaceView`/`AgentView`.