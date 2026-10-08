# nessy-orch

Оркестратор агентов nessy: HTTP/SSE API и UI на `127.0.0.1:4337`, CLI `nessy-orch`. Через него ты (Claude) делегируешь
задачи агентам nessy, у которых есть dp-инструменты (GitLab, Jira, Sage, Wiki) и долгая автономная работа.

## Использование сервиса

Скилл **`nessy-orch`** (`.claude/skills/nessy-orch/SKILL.md`) описывает команды, сценарии и обработку ошибок.
Коротко:

```bash
nessy-orch ask <путь> "задача"                         # создать агента и дождаться ответа
nessy-orch spawn --space <путь> --name N "задача"      # в фоне; ответы — nessy-orch inbox --wait 600
nessy-orch send <агент> --wait "уточнение"             # продолжить с тем же агентом
nessy-orch ls | show <агент> | kill <агент>
```

Если команда падает с «оркестратор недоступен», сам его не запускай. Попроси пользователя выполнить
`node ~/Projects/nessy-orch/dist/src/main.js`.
Старые `nessy-ask`, `nessy-jobs` и `nessy-watch` работают как алиасы.

## Разработка в этом репозитории

- Устройство проекта описано в README.md (архитектура, API, CLI, UI) и в `docs/` (требования, API, контракт nessy serve).
- Сервер на TypeScript без рантайм-зависимостей, слои `domain → application → infrastructure → interfaces`.
  Типы лежат только в `types.ts`, `*.types.ts` и `ports.ts`. Контракт с UI находится в `shared/types/`.
- UI: React + Vite в `ui/src`, Feature-Sliced (app/widgets/features/entities/shared), CSS Modules, токены в `ui/src/app/styles/tokens.css`.
- Протокол nessy знает только `src/infrastructure/nessy/`.
- Проверки: `npm run check` (typecheck + lint + тесты сервера), `npm run build && npm run test:e2e` (Playwright).
- Стиль: табы, без точек с запятой, одинарные кавычки, комментарии по-русски. `any` и `@ts-ignore` запрещены.
