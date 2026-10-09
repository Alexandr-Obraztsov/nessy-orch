# nessy-orch

Оркестратор агентов nessy: HTTP/SSE API и UI на `127.0.0.1:4337`, CLI `nessy-orch`. Через него ты (Claude) делегируешь
задачи агентам nessy, у которых есть dp-инструменты (GitLab, Jira, Sage, Wiki) и долгая автономная работа.

## Использование сервиса: ты — оркестратор

При любой задаче через nessy-orch (GitLab, Jira, Sage, Wiki, чужой репозиторий, «спроси nessy») **сначала
загрузи скилл `nessy-orch`** (плагин `nessy`: `plugins/nessy/skills/nessy-orch/SKILL.md`, в этом репозитории
доступен и как `.claude/skills/nessy-orch` — симлинк) и работай по его циклу: заведи задачу
(`nessy-orch task new "<краткая цель>" --owner claude` → id) и сразу дай пользователю ссылку на неё
http://127.0.0.1:4337/?task=<id> → осмотрись (`ls --all --task <id>`, `role ls`) → разбей задачу → выбери роль →
напиши поручение по шаблону → запусти (независимое — параллельно, все `spawn` с `--task <id>`) → проверь результат
(отдельным `verifier`) → сведи ответ → `task done <id> --summary "<итог>"`. Продолжение темы — в той же задаче,
новая тема — новая задача. Задачи нужны, чтобы несколько Claude работали параллельно: у каждой задачи свой inbox.
С момента загрузки скилла ты **только оркестратор**: сам не пишешь код и не делаешь работу руками (даже мелочи),
не используешь своих субагентов для исполнения — всё делают агенты nessy, ты планируешь, проверяешь и сводишь.
(Это относится к работе через nessy-orch, а не к разработке самого этого репозитория.)

```bash
nessy-orch task new "<краткая цель>" --owner claude                        # id задачи + ссылка на панель
nessy-orch spawn --task <id> --space <путь> --role <роль> --name <имя> "<поручение>"   # сразу возвращается
nessy-orch inbox --task <id> --wait 1500   # ТОЛЬКО в фоне (Bash run_in_background) — ответ придёт уведомлением
nessy-orch send <агент> "уточнение"                                         # продолжить с тем же агентом
nessy-orch task done <id> --summary "<короткий итог>"                       # в конце
```

Всё, что ждёт агентов (`inbox --wait`, `--wait`, `ask`), запускай только в фоне, чтобы не замерзать: пока агенты
работают, продолжай разговор с пользователем. Сборщик `inbox --task <id>` держи один на задачу.

Для типовых задач в плагине есть рецепты (`code-question`, `mr-review`, `incident`,
`jira-report`, `implement`) и команды `/nessy:ui`, `/nessy:status`. Установка плагина в любом проекте:
`/plugin marketplace add <путь или git URL репозитория>` → `/plugin install nessy@nessy-orch` (см. README).

Готовые роли лежат в `roles/*.md` и загружаются командой `nessy-orch role import`. Например, `code-explorer`
изучает чужой репозиторий: клонирует его, ищет по коду (`rg`), отвечает и удаляет клон.
Если команда падает с «оркестратор недоступен», сам его не запускай: ты в песочнице, и сервер с агентами
оказались бы в ней же. Попроси пользователя выполнить в обычном терминале `bin/nessy-orch install` (сервис
launchd, запускается через login shell с окружением терминала) или `node ~/Projects/nessy-orch/dist/src/main.js`.

## Разработка в этом репозитории

- Устройство проекта описано в README.md (архитектура, API, CLI, UI) и в `docs/` (требования, API, контракт nessy serve).
- Сервер на TypeScript без рантайм-зависимостей, слои `domain → application → infrastructure → interfaces`.
  Типы лежат только в `types.ts`, `*.types.ts` и `ports.ts`. Контракт с UI находится в `shared/types/`.
- UI: React + Vite в `ui/src`, Feature-Sliced (app/widgets/features/entities/shared), CSS Modules, токены в `ui/src/app/styles/tokens.css`.
- Протокол nessy знает только `src/infrastructure/nessy/`.
- Проверки: `npm run check` (typecheck + lint + тесты сервера), `npm run build && npm run test:e2e` (Playwright).
- Стиль: табы, без точек с запятой, одинарные кавычки, комментарии по-русски. `any` и `@ts-ignore` запрещены.
