# Исследование оркестраторов агентов: что взять в nessy-orch

Дата: 2026-10-10. Собрано пятью исследователями (Haiku) по открытым источникам; часть данных — по обзорам и сниппетам поиска,
такие места помечены. Официальные страницы Apple HIG и уведомлений не открылись, правила Liquid Glass взяты из вторичных источников.

## 1. Что есть у других (лучшее)

| Продукт | Лучшие фишки |
|---|---|
| **Claude Code Desktop** (апрель 2026) | Сайдбар всех сессий с фильтром по статусу/проекту и группировкой; сессия сама уходит в архив, когда PR влит; side chat (⌘;) — вопрос в ветке, не загрязняющий контекст; режимы вывода Verbose / Normal / Summary; панели перетаскиваются |
| **Conductor, Codex app, Cursor 3, Superset, Crystal** | Каждый агент в своём git worktree (изоляция); результаты в очередь «на проверку»; Superset: звук + бейдж в Dock, когда агенту нужен человек; Cursor: сравнение результатов бок о бок |
| **Warp Oz** | Статусы working / blocked / failed / success / canceled; карточка запуска: план, команды, логи; дочерние запуски — отдельная вкладка; «родитель закончил» ≠ «дети закончили»; неинтерактивный запуск при ожидании → Blocked, а не вечное ожидание |
| **Copilot agent, Devin, Codex cloud** | Обзор (прогресс, **токены, длительность**) + журнал рассуждений и инструментов; Devin: чип working/blocked/done, уведомления по переходам состояния |
| **Factory** | Иерархия milestone → feature, живой лог, таймер, кредиты (по сниппетам) |
| **Replit** | Чекпоинт после каждого шага плана, откат |
| **CCManager, agent-deck** | Статусы busy/waiting/idle/error; `waiting` — отдельное состояние; демон уведомлений **на переходах** running → waiting/error/idle; восстановление после падения демона |
| **Ruflo (claude-flow)** | «Кокпит»: токены и стоимость по запуску, failure triage, replay |
| **OpenAI Agents SDK, LangSmith, Langfuse, Temporal** | span с `parent_id`, `kind`, `started_at/ended_at`, `status`, `error`; `usage` по ключам input/output/cache_read; агрегаты считаются при записи на уровне run и session; события handoff/spawn; Temporal: Timeline / Compact / JSON-виды |
| **Anthropic multi-agent research** | Трассировка структуры решений, а не содержимого разговоров; отдельный CitationAgent собирает источники |

Сигналы самого Claude Code (хуки): `Stop`, `SubagentStop`, `Notification` (`permission_prompt`, `idle_prompt`), `SessionStart`/`SessionEnd`.
Права: порядок deny → ask → allow, первое совпадение побеждает; Warp: denylist по умолчанию (rm, curl, wget, eval) приоритетнее allowlist.
Показа **уровня риска** команды не нашли ни у кого — наша оценка риска (`Risk.swift`) отличает продукт.

## 2. Что взять в ядро (по убыванию ценности)

| # | Предложение | Откуда | Статус |
|---|---|---|---|
| 1 | **Сессия = один разговор Claude**; всё копится в ней: агенты, источники, токены | Claude Desktop, Langfuse (session), LangSmith (thread) | сделано |
| 2 | **Источники сессии** отдельной таблицей (ссылки из ответов и вызовов инструментов, дедупликация) | Anthropic CitationAgent | сделано (`GET /sessions/:id/sources`) |
| 3 | **Счётчики и токены**: ходы, инструменты, время, input/output/cached; токены из `usage` хода или `/stats` | Copilot, Warp, Langfuse | сделано; форма `/stats` в контракте nessy не подтверждена — разбор по именам полей |
| 4 | **Статус ответа** `DONE/BLOCKED/NEEDS_CONTEXT` программно (`lastReply.status`) | Warp blocked, Devin | сделано |
| 5 | **Временные отказы nessy** (429/503) с повтором | — | сделано |
| 6 | **Ждёт решения** как первоклассное состояние + события-переходы `attention` в стриме (permission / blocked / error / result), чтобы клиенты не выводили их сами | agent-deck notify-daemon, Devin | предлагается |
| 7 | **Тайминги инструментов**: `startedAt/endedAt/durationMs`, поле `error` у вызова; тип `spawn/handoff` в ленте | OpenAI SDK spans, Temporal | предлагается |
| 8 | **Хуки Claude Code → сессия оркестратора**: `SessionStart` сам создаёт сессию и кладёт `NESSY_ORCH_SESSION` в `CLAUDE_ENV_FILE`; `Stop`/`Notification` → «Claude ждёт вас»; `SessionEnd` → закрыть. Решает «заброшенные сессии» и «Claude заводит сессию один раз» без дисциплины от модели | Claude Code hooks | предлагается; `CLAUDE_ENV_FILE` проверить по документации |
| 9 | **Потерянный ход при рестарте** демона: пометка в чате + возможность повторить | CCManager (sessions.json), Temporal | предлагается |
| 10 | **Дерево** родитель → субагенты и сводный статус сессии («дети ещё работают») | Warp | в приложении; в ядре — `session.rollup` |
| 11 | **Политика прав** allow/ask/deny (deny → ask → allow, умолчания rm/curl/wget/eval), «запомнить» на space+команду, журнал авто-разрешений | Claude Code, Warp | предлагается (крупное) |
| 12 | **Изоляция worktree на агента** для исполнителей кода (space на worktree) | Все десктопные оркестраторы | отложено: serve привязан к одному воркспейсу, нужен space на worktree |
| 13 | Diff `+N −M` на агента/space | Claude Code web, Codex | отложено |
| 14 | Агрегаты сессии при записи (токены, шаги, время) в `SessionView.stats`, чтобы не терять при удалении агентов | Langfuse, LangSmith | предлагается |

Сознательно не берём: «conductor»-агент, авто-отвечающий на права (риск неверных ответов), принуждение слабых моделей к плану
(решение пользователя: план желателен, но не обязателен), лимит параллельных агентов.

## 3. Что взять в приложение

- **Список, а не доска**: сайдбар сессий (фильтр по статусу, авто-архив) → строки агентов с шагом плана и текущим инструментом.
- **Окно агента** (не шторка): итог, журнал рассуждений и инструментов, режимы детализации Summary / Normal / Verbose.
- **Уведомления по переходам**: ждёт решения (с кнопками), blocked, ошибка, сессия закрыта; результаты без звука копятся в бейдже Dock.
- **Вкладки сессии**: Агенты · Источники · Статистика (токены, ходы, время, инструменты).
- **Liquid Glass только на слое управления** (тулбар, сайдбар, плавающие панели, кнопки), контент — обычные поверхности; без «стекла на стекле»;
  тинт только у главного действия.
- **Палитра**: нейтральная системная база, один акцент (синий), цвет только для «нужны вы» (янтарь) и ошибки (красный);
  выполненное тускнеет в серый, **зелёного и оранжевого вместе не используем**.

## 4. Источники

Claude Code Desktop <https://claude.com/blog/claude-code-desktop-redesign> · Conductor <https://www.conductor.build/> ·
Claude Squad <https://github.com/smtg-ai/claude-squad> · CCManager <https://github.com/kbwo/ccmanager> ·
agent-deck <https://github.com/asheshgoplani/agent-deck> · Warp Oz <https://docs.warp.dev/agent-platform/cloud-agents/managing-cloud-agents> ·
Copilot <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/track-copilot-sessions> ·
Devin <https://docs.devin.ai/integrations/slack.md> · OpenAI tracing <https://openai.github.io/openai-agents-python/tracing/> ·
Langfuse <https://langfuse.com/docs/observability/data-model> · Temporal <https://docs.temporal.io/web-ui> ·
Anthropic <https://www.anthropic.com/engineering/multi-agent-research-system> · Claude Code hooks <https://code.claude.com/docs/en/hooks> ·
Claude Code permissions <https://code.claude.com/docs/en/permissions> · Warp permissions <https://docs.warp.dev/agents/autonomy/agent-permissions>
