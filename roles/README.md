# Готовые роли

Каждая роль — один файл `roles/<id>.md`: frontmatter с полями и тело с инструкциями (markdown).

```markdown
---
id: reviewer
name: Ревьюер
description: "Смотрит MR: баги, стиль, тесты"
color: 210
---
Ты — ревьюер кода. Проверяй…
```

## Поля frontmatter

| Поле | Обязательно | Описание |
|---|---|---|
| `id` | да | slug роли: `[a-z0-9-]`, до 40 символов |
| `name` | да | Имя, до 60 символов, уникальное |
| `description` | нет | Короткое описание, до 300 символов |
| `color` | нет | Оттенок метки, число 0..360 (по умолчанию из имени) |

Формат строгий: файл начинается со строки `---`, дальше по одной строке `ключ: значение`, блок закрывает строка `---`.
Значение можно взять в кавычки (`"…"` или `'…'`) — нужно, если оно начинается с кавычки или `#`, либо есть пробелы по краям.
Пустые строки и строки `# …` во frontmatter игнорируются. Всё после закрывающей `---` — инструкции роли (до 20000 символов).

## Как загружаются

- `README.md` и файлы без frontmatter с `id` и `name` не импортируются.
- Первый запуск оркестратора (пока нет `~/.nessy-orch/roles.json`): роли из этой папки заливаются сами; отключить — `ORCH_SEED_ROLES=0`.
- Вручную: `nessy-orch role import [путь] [--force] [--dry-run]` — существующие роли пропускаются, `--force` их перезаписывает.
- Обратно в файл: `nessy-orch role export <id> [--out файл]`.

## Встроенные роли

Лицензии и источники адаптаций: [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Все роли заканчивают ответ строкой
`Статус: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` и причиной.

| id | Название | Назначение | Источник |
|---|---|---|---|
| `analyst` | Аналитик | Разбор задачи: требования, критерии приёмки, пробелы, риски, план. Код не меняет | oh-my-claudecode (analyst, planner) |
| `architect` | Архитектор | Дизайн и ревью архитектуры, trade-offs, миграция. Код не меняет | oh-my-claudecode (architect), wshobson/agents (architect-review) |
| `code-reviewer` | Ревьюер кода | Ревью ветки или правок: сначала соответствие задаче, затем качество, severity и уверенность | oh-my-claudecode (code-reviewer), wshobson/agents (team-reviewer) |
| `gitlab-mr-reviewer` | Ревьюер MR в GitLab | Ревью MR по ссылке: диф, pipeline, комментарии, тикет. По умолчанию ничего не публикует | своя, по oh-my-claudecode (code-reviewer) |
| `debugger` | Отладчик | Воспроизведение, гипотезы, корневая причина, минимальный фикс (если разрешён) | oh-my-claudecode (debugger, tracer), wshobson/agents (team-debugger) |
| `executor` | Исполнитель | Реализация задачи малыми проверяемыми шагами с тестами, без коммитов и пушей | oh-my-claudecode (executor), obra/superpowers (implementer-prompt) |
| `test-engineer` | Тест-инженер | Стратегия тестирования, написание тестов, лечение флаки | oh-my-claudecode (test-engineer) |
| `verifier` | Верификатор | Независимая проверка чужого результата с доказательствами, без доверия отчёту | oh-my-claudecode (verifier), obra/superpowers (verification-before-completion, task-reviewer-prompt) |
| `security-reviewer` | Ревьюер безопасности | Поиск уязвимостей, секретов, проблем зависимостей, оценка риска | oh-my-claudecode (security-reviewer) |
| `jira-analyst` | Аналитик Jira | Поиск и сводка задач, связи, требования, пробелы. Только чтение | своя, по oh-my-claudecode (analyst) |
| `wiki-researcher` | Исследователь Wiki | Поиск в Wiki и Sage, синтез со ссылками и уверенностью. Только чтение | своя, по oh-my-claudecode (document-specialist), VoltAgent (research-analyst, knowledge-synthesizer) |
| `writer` | Технический писатель | Документация, README, ADR, инструкции с проверенными примерами | oh-my-claudecode (writer, document-specialist) |
| `simplifier` | Упрощатель кода | Упрощение и рефакторинг без изменения поведения | oh-my-claudecode (code-simplifier), VoltAgent (refactoring-specialist) |
| `performance` | Инженер по производительности | Профилирование, замеры до и после, точечная оптимизация | своя; VoltAgent (performance-engineer) только как чек-лист тем |
| `code-explorer` | Исследователь кода | Клонирует репозиторий, ищет по коду (`rg`), отвечает на вопрос и удаляет клон | своя |
