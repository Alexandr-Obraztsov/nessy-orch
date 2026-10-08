# nessy-orch

Оркестратор агентов nessy: HTTP/SSE API и UI на `127.0.0.1:4337`, CLI `nessy-orch`. Через него ты (Claude) делегируешь
задачи агентам nessy, у которых есть dp-инструменты (GitLab, Jira, Sage, Wiki) и долгая автономная работа.

## Использование сервиса: ты — оркестратор

При любой задаче через nessy-orch (GitLab, Jira, Sage, Wiki, чужой репозиторий, «спроси nessy») **сначала
загрузи скилл `nessy-orch`** (`.claude/skills/nessy-orch/SKILL.md`) и работай по его циклу:
осмотрись (`ls --all`, `role ls`) → разбей задачу → выбери роль → напиши поручение по шаблону → запусти
(независимое — параллельно) → проверь результат (отдельным `verifier`) → сведи ответ.
Сам ты не исполнитель: агенты nessy работают руками, ты планируешь, проверяешь и сводишь.

```bash
nessy-orch spawn --space <путь> --role <роль> --name <имя> "<поручение>"   # в фоне; ответы — inbox --wait 600
nessy-orch send <агент> --wait "уточнение"                                  # продолжить с тем же агентом
```

Готовые роли лежат в `roles/*.md` и загружаются командой `nessy-orch role import`. Например, `code-explorer`
изучает чужой репозиторий: клонирует его, индексирует codegraph, отвечает и удаляет клон.
Если команда падает с «оркестратор недоступен», сам его не запускай. Попроси пользователя выполнить
`node ~/Projects/nessy-orch/dist/src/main.js`.

## Разработка в этом репозитории

- Устройство проекта описано в README.md (архитектура, API, CLI, UI) и в `docs/` (требования, API, контракт nessy serve).
- Сервер на TypeScript без рантайм-зависимостей, слои `domain → application → infrastructure → interfaces`.
  Типы лежат только в `types.ts`, `*.types.ts` и `ports.ts`. Контракт с UI находится в `shared/types/`.
- UI: React + Vite в `ui/src`, Feature-Sliced (app/widgets/features/entities/shared), CSS Modules, токены в `ui/src/app/styles/tokens.css`.
- Протокол nessy знает только `src/infrastructure/nessy/`.
- Проверки: `npm run check` (typecheck + lint + тесты сервера), `npm run build && npm run test:e2e` (Playwright).
- Стиль: табы, без точек с запятой, одинарные кавычки, комментарии по-русски. `any` и `@ts-ignore` запрещены.
