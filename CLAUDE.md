# nessy-orch

Оркестратор агентов nessy: HTTP/SSE API на `127.0.0.1:4337`, нативное macOS-приложение «Nessy Orch» (`app/`, SwiftUI), CLI `nessy-orch`. Через него ты (Claude) делегируешь
задачи агентам nessy, у которых есть dp-инструменты (GitLab, Jira, Sage, Wiki) и долгая автономная работа.

## Использование сервиса: ты — оркестратор

При любой задаче через nessy-orch (GitLab, Jira, Sage, Wiki, чужой репозиторий, «спроси nessy») **сначала
загрузи скилл `nessy-orch`** (плагин `nessy`: `plugins/nessy/skills/nessy-orch/SKILL.md`, в этом репозитории
доступен и как `.claude/skills/nessy-orch` — симлинк) и работай по его циклу: заведи сессию **один раз на весь разговор**
(`nessy-orch session new "<краткая цель>" --owner claude` → id) и сразу дай пользователю ссылку
`nessy-orch://session/<id>` (открывает её в приложении Nessy Orch) → осмотрись (`ls --all --session <id>`, `role ls`) →
разбей задачу → выбери роль → напиши поручение по шаблону → запусти (независимое — параллельно, все `spawn` с
`--session <id>`) → проверь результат (отдельным `verifier`) → сведи ответ → в конце разговора `session done <id> --summary "<итог>"`.
Сессия одна на разговор: смена темы её не меняет. Сессии нужны, чтобы несколько Claude работали параллельно: у каждой свой inbox,
свои источники и счётчики токенов.
С момента загрузки скилла ты **только оркестратор**: сам не пишешь код и не делаешь работу руками (даже мелочи),
не используешь своих субагентов для исполнения — всё делают агенты nessy, ты планируешь, проверяешь и сводишь.
(Это относится к работе через nessy-orch, а не к разработке самого этого репозитория.)

```bash
nessy-orch session new "<краткая цель>" --owner claude                     # один раз: id сессии + ссылка nessy-orch://session/<id>
nessy-orch spawn --session <id> --space <путь> --role <роль> --name <имя> "<поручение>"   # сразу возвращается
nessy-orch inbox --session <id> --wait 1500   # ТОЛЬКО в фоне (Bash run_in_background) — ответ придёт уведомлением
nessy-orch send <агент> "уточнение"                                         # продолжить с тем же агентом
nessy-orch session done <id> --summary "<короткий итог>"                       # в конце
```

Всё, что ждёт агентов (`inbox --wait`, `--wait`, `ask`), запускай только в фоне, чтобы не замерзать: пока агенты
работают, продолжай разговор с пользователем. Сборщик `inbox --session <id>` держи один на сессию.

Для типовых задач в плагине есть рецепты (`code-question`, `mr-review`, `incident`,
`jira-report`, `implement`) и команды `/nessy:ui`, `/nessy:status`. Установка плагина в любом проекте:
`/plugin marketplace add <путь или git URL репозитория>` → `/plugin install nessy@nessy-orch` (см. README).

Готовые роли лежат в `roles/*.md` и загружаются командой `nessy-orch role import`. Например, `code-explorer`
изучает чужой репозиторий: клонирует его, ищет по коду (`rg`), отвечает и удаляет клон.
Если команда падает с «оркестратор недоступен», сам его не запускай: ты в песочнице, и сервер с агентами
оказались бы в ней же. Попроси пользователя выполнить в обычном терминале `bin/nessy-orch install` (сервис
launchd, запускается через login shell с окружением терминала) или `node ~/Projects/nessy-orch/dist/src/main.js`.

## Разработка в этом репозитории

- Устройство проекта описано в README.md (архитектура, API, CLI) и в `docs/` (требования, API, контракт nessy serve,
  `native-app-design.md` и `design/` — дизайн приложения, `research-orchestrators.md` — исследование аналогов).
- Сервер на TypeScript без рантайм-зависимостей, слои `domain → application → infrastructure → interfaces`.
  Типы лежат только в `types.ts`, `*.types.ts` и `ports.ts`. Контракт с клиентами находится в `shared/types/`.
- Сессия оркестратора (`session`: один разговор Claude) и сессия nessy (`nessyId`, `sessionId` в протоколе) — разные вещи;
  в коде агента сессия nessy называется `nessyId`.
- Приложение: `app/` — SwiftPM (`NessyKit` — модель, API, SSE, состояние, тесты `swift test`; `NessyOrch` — SwiftUI, macOS 26).
  Сборка `.app`: `app/scripts/build-app.sh`. Схема для ссылок: `nessy-orch://session/<id>`, `nessy-orch://agent/<id>`.
- Веб-UI (`ui/`, `e2e/`) выведен из сборки и проверок и не поддерживается; удалить его можно по решению владельца.
- Проверки: `npm run check` (typecheck + lint + тесты сервера), `cd app && swift test` (тесты NessyKit).
- Стиль: табы, без точек с запятой, одинарные кавычки, комментарии по-русски. `any` и `@ts-ignore` запрещены.
