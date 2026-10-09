# nessy-orch

Оркестратор агентов **nessy**. Главная нода («Вы» — человек и Claude Code) запускает независимых агентов nessy
в рабочих пространствах, пишет им и получает ответы. Агенты могут писать друг другу. Вся переписка видна в одной
общей ленте, состояние — в живом графе.

Зачем: у nessy есть доступ к dp-инструментам (GitLab, Jira, Sage, Wiki) и долгая автономная работа в воркспейсе,
которых нет у Claude в песочнице. nessy-orch даёт простой способ делегировать nessy задачи и следить за ними.

![Внимание, поручения и детали агента — тёмная тема](docs/screenshots/desktop-dark.png)

<p>
  <img src="docs/screenshots/desktop-light.png" alt="Светлая тема" width="68%">
  <img src="docs/screenshots/mobile-dark.png" alt="Мобильная версия" width="23%">
</p>

## Возможности

- **Пространства (spaces).** Пространство = каталог-воркспейс + процесс `nessy serve`, который запускает оркестратор
  (managed), либо уже запущенный демон по URL (external). Порты выделяются автоматически.
- **Агенты.** Каждый агент — независимая сессия nessy (`sessionScope: thread`). Статусы простые: `starting`,
  `working`, `idle`, `error`. У агента есть очередь сообщений: сообщения агентов друг другу ждут своей очереди,
  а ваше сообщение работающему агенту прерывает текущий ход и доставляется первым (`send --queue` — в очередь).
  Очередь переживает рестарт.
- **Архив.** Агент, успешно закончивший задачу, уходит в архив: он скрыт из рабочего списка, но сессия и контекст
  сохранены. Любое сообщение будит его, поэтому к агенту по имени можно вернуться в любой момент. Ход с ошибкой
  оставляет агента на виду; упавшая сессия пересоздаётся при следующем сообщении.
- **Роли.** Сохранённые инструкции (`role add`), которые попадают во вводную агента: `spawn --role reviewer`.
- **Произвольный граф общения.** `Вы ↔ агент`, `агент ↔ агент`. Ответ агента автоматически уходит отправителю.
  Агенты пишут другим сами, через shell: `nessy-orch send --from <id> <кому> "текст"`.
- **Защиты.** Лимит длины цепочки (8 переходов), лимит сообщений на пару (30 в минуту), обнаружение взаимного
  ожидания (`409 deadlock`), проверка `Host`/`Origin` (защита от DNS-rebinding и CSRF из браузера).
- **Права.** По умолчанию запросы прав подтверждаются автоматически (с записью в журнал агента). При
  `ORCH_AUTO_APPROVE=0` запросы ждут решения в UI или через API.
- **Устойчивость.** Падение `nessy serve` или рестарт оркестратора — сессия агента восстанавливается при следующем
  обращении. Состояние и роли пишутся атомарно в `~/.nessy-orch/`.
- **Веб-интерфейс** — панель поручений: очередь «Внимание», прогресс каждой задачи и агента, детали с планом и шагами, журнал. Работает на десктопе и телефоне.
- **CLI** — единый бинарь `nessy-orch`: предсказуемый вывод, `--json`, блокирующий (`--wait`) и фоновый режимы.

## Быстрый старт

Нужен Node.js ≥ 20 и установленный `nessy` (по умолчанию `~/.local/bin/nessy`).

```sh
cd ~/Projects/nessy-orch
npm install
npm run build                       # сервер + UI
node dist/src/main.js               # оркестратор на http://127.0.0.1:4337
```

Откройте <http://127.0.0.1:4337> (или `bin/nessy-orch open`).

Чтобы оркестратор работал постоянно, установите его как сервис launchd (macOS, `KeepAlive`). Запускайте
`install` из обычного терминала — не из Claude Code: внутри песочницы Claude сервер и его агенты тоже окажутся
в песочнице.

```sh
bin/nessy-orch install              # --print — только показать plist
bin/nessy-orch uninstall
```

Сервис стартует через login shell пользователя (`zsh -lic`), поэтому получает то же окружение, что и терминал:
`PATH`, прокси, корпоративные сертификаты, токены из `~/.zprofile` и `~/.zshrc`. Без них канал nessy
(`nessy-acp-agent`) не может стартовать, и создание сессии падает с `AcpSessionBridge newSession timeout`.
После изменения этих настроек перезапустите сервис: `launchctl kickstart -k gui/$(id -u)/com.nessy.orch`.
Не запускайте второй экземпляр руками, пока работает сервис: выберите один способ.

Первые шаги из терминала:

```sh
bin/nessy-orch space add ~/Projects/shippy
bin/nessy-orch spawn --space shippy --name reviewer --wait "посмотри README и скажи, что это"
bin/nessy-orch feed -n 20
```

### Демо без настоящего nessy

В комплекте есть фейковый `nessy serve`: он повторяет контракт API и отвечает по простым правилам. Этого хватает,
чтобы посмотреть интерфейс и прогнать тесты.

```sh
npm run demo                        # сборка + оркестратор с фейковым nessy
```

Команды фейкового агента (в тексте задачи): `#tools` — серия вызовов инструментов, `#long` — длинный markdown-ответ
потоком, `#shell <команда>` — инструмент shell, `#perm` — запрос прав, `#slow` — долгий ход (можно прервать),
`#error` — ошибка хода, `#fail` — падение сессии, `#relay <кому> <текст>` — сообщение другому агенту. Любой другой
текст возвращается эхом.

## Веб-интерфейс

Панель управления поручениями. С одного взгляда видно, что ждёт вас, что сейчас делается и насколько
продвинулось, что уже готово. Проект и обоснование — [docs/ui-design.md](docs/ui-design.md), макеты вариантов —
[docs/mockups/](docs/mockups/).

| Зона | Что там |
|---|---|
| **Верхняя строка** | Счётчики «ждут вас / ошибки / в работе / готово» — это и фильтры. Поиск, «+ Поручение», меню ⚙ (роли, пространства), тема |
| **Внимание** (слева) | Очередь того, что ждёт вас: запросы разрешений с кнопками «Разрешить / Отклонить», ошибки с «Повторить», новые результаты с превью. Обработанное исчезает само |
| **Поручения** (центр) | Карточка на каждую задачу: корневой агент и все, кого он породил. Сводный статус, прогресс (по плану или «готово агентов N из M»), время. В строке агента — текущее действие, мини-план, число шагов, таймер хода, очередь |
| **Детали агента** (справа) | Баннер, если агент ждёт вас. «Сейчас» (инструмент и его длительность), план-чек-лист. Вкладки «Результат» (markdown, ссылки чипами), «Шаги» (таймлайн вызовов инструментов), «Чат». Поле ввода с галочкой «прервать текущий ход» |
| **Журнал** (внизу) | Вся хронология сообщений и событий с фильтрами. Свёрнут в одну строку |

Прогресс честный: процентный бар появляется, только когда известен знаменатель — план агента или число агентов
в поручении. План агенты публикуют сами (`nessy-orch plan --from <id> "- [x] …" "- [ ] …"`) или он приходит из
протокола nessy (ACP `plan`).

На экранах уже 900 px — нижние вкладки «Внимание / Поручения / Журнал», детали агента на весь экран.
Тёмная и светлая темы. Горячие клавиши: `n` — новое поручение, `/` — поиск, `j`/`k` — по строкам, `Enter` —
открыть, `a` — разрешить, `x` — прервать, `Esc` — закрыть.
## CLI

```text
nessy-orch spawn [--space S] [--name N] [--role R] [--wait] [--timeout СЕК] ["задача"]
nessy-orch send <агент|you> "текст" [--wait] [--queue] [--timeout СЕК] [--from ID]
nessy-orch ask <путь|space> "задача"          # = spawn --wait
nessy-orch ls [--all] | show <агент> | watch <агент> | cancel <агент> | kill <агент>
nessy-orch archive <агент> | restore <агент>
nessy-orch plan <агент> | plan --from <свой id> "- [x] …" "- [~] …" "- [ ] …" [--clear]   # план агента: показать | опубликовать (агент сам)
nessy-orch role ls | role add <имя> --instructions "…" | --file <путь> [--description D] [--id ID] | role show <id> | role rm <id>
nessy-orch role import [путь] [--force] [--dry-run]   # роли из markdown-файлов (по умолчанию roles/); role export <id> [--out файл]
nessy-orch feed [-n 30] [--follow]
nessy-orch inbox [--wait СЕК] [--peek]
nessy-orch space add <путь> [--name N] [--url URL] | space ls | space rm <имя> [--force]
nessy-orch status | open | install [--print] | uninstall
```

Полезный результат (ответ агента, JSON) выводится в stdout, служебные сообщения — в stderr. Флаг `--json` есть у всех
команд. `send` работающему агенту прерывает его ход (`--queue` — дождаться очереди). `ls` скрывает агентов в архиве,
`ls --all` показывает всех. Старые алиасы `nessy-ask`, `nessy-jobs`, `nessy-watch` оставлены для совместимости.

## Плагин для Claude Code

Репозиторий — маркетплейс плагинов Claude Code (`.claude-plugin/marketplace.json`) с одним плагином `nessy`
в [`plugins/nessy/`](plugins/nessy/). Плагин переводит Claude в роль ведущего: работая через nessy-orch, Claude
не выполняет задачу сам, а проходит цикл:

0. Сразу пишет пользователю ссылку на панель <http://127.0.0.1:4337>.
1. Осматривается: `ls --all`, `role ls` (ролей нет — `role import`).
2. Оценивает объём и делит задачу на независимые части.
3. Подбирает для каждой части роль.
4. Пишет самодостаточное поручение: цель, контекст, границы, источники, формат результата, критерий готовности.
5. Запускает агентов (независимые части параллельно) и собирает ответы через `inbox`; ход смотрит по плану
   агента (`plan`), который сервер требует вести от каждого агента.
6. Проверяет результат отдельным агентом-`verifier`.
7. Сводит итог пользователю.

Каждый агент с ролью заканчивает ответ статусом `DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT`, и Claude
решает по нему, что делать дальше. Запись во внешние системы (комментарии в GitLab, правки в Jira) разрешена
только по прямой просьбе пользователя.

### Установка

В Claude Code:

```text
/plugin marketplace add Alexandr-Obraztsov/nessy-orch      # или git URL, или локальный путь: ./путь/к/nessy-orch
/plugin install nessy@nessy-orch
```

Из shell — то же самое: `claude plugin marketplace add <источник>` и `claude plugin install nessy@nessy-orch`.
Обновить: `/plugin marketplace update nessy-orch` (затем `/reload-plugins`), или в `/plugin` → **Marketplaces** →
**Update marketplace**. Маркетплейс, добавленный из локального каталога, читается на месте: правки в
`plugins/nessy/` подхватываются после `/reload-plugins`. CLI `nessy-orch` должен быть в PATH (или лежать в
`~/Projects/nessy-orch/bin/`). Проверить манифесты: `claude plugin validate .`.

### Что внутри

| Компонент | Вызов | Что делает |
|---|---|---|
| Скилл `nessy-orch` | `/nessy:nessy-orch`, загружается сам | Цикл оркестратора, выбор роли, шаблон поручения, правила, «красные флаги», ошибки; `references/commands.md` — справочник команд, `references/briefs.md` — общие схемы и указатель рецептов |
| Скилл `nessy-code-question` | `/nessy:nessy-code-question` | Вопрос по коду чужого репозитория: `code-explorer` (+ `verifier`) |
| Скилл `nessy-mr-review` | `/nessy:nessy-mr-review` | Ревью MR: `gitlab-mr-reviewer` ‖ `jira-analyst` (+ `security-reviewer`), черновики комментариев без публикации |
| Скилл `nessy-incident` | `/nessy:nessy-incident` | Инцидент: `debugger` ‖ `wiki-researcher` / `jira-analyst`, хронология и гипотезы |
| Скилл `nessy-jira-report` | `/nessy:nessy-jira-report` | Сводка задач Jira таблицей: `jira-analyst` |
| Скилл `nessy-implement` | `/nessy:nessy-implement` | Изменение кода: `analyst` → `executor` → `verifier` |
| Команда `ui` | `/nessy:ui` | Ссылка на панель и `nessy-orch status` |
| Команда `status` | `/nessy:status` | `nessy-orch ls --all` и короткая сводка |

Роли в плагин не входят: они живут в [`roles/`](roles/) и загружаются в оркестратор (см. ниже).
Внутри этого репозитория скилл `nessy-orch` доступен и без установки плагина: `.claude/skills/nessy-orch` —
симлинк на `plugins/nessy/skills/nessy-orch`.

Подход собран из obra/superpowers, wshobson/agents, oh-my-claudecode и статьи Anthropic о мультиагентной системе
(см. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

## Роли агентов

Готовые роли лежат в [`roles/`](roles/) markdown-файлами (формат описан в [roles/README.md](roles/README.md)).
При первом запуске оркестратор загружает их сам, потом их можно обновить командой `nessy-orch role import --force`.
Одна из них, `code-explorer`, изучает чужой репозиторий: клонирует его во временный каталог, ищет по коду (`rg`, `git grep`),
отвечает со ссылками `файл:строка` и удаляет клон.

## HTTP API

`127.0.0.1:4337`, JSON, без аутентификации (только loopback).

| Метод и путь | Назначение |
|---|---|
| `GET /health`, `GET /status`, `GET /graph` | Служебное: здоровье, состояние, пространства, агенты и роли |
| `GET /spaces`, `POST /spaces {path,name?,url?}`, `DELETE /spaces/:name?force=1` | Пространства |
| `GET /agents`, `POST /agents {space?,name?,role?,prompt?,parent?,from?,wait?}` | Список (включая архивных) и создание агентов |
| `GET /agents/:ref`, `DELETE /agents/:ref` | Агент |
| `POST /agents/:ref/send {text,from?,interrupt?,wait?}`, `POST /agents/:ref/cancel` | Сообщение (от «Вы» по умолчанию прерывает ход), прервать ход |
| `POST /agents/:ref/plan {from?,entries}`, `DELETE /agents/:ref/plan` | План агента (публикует сам агент; чужой `from` → `403`) |
| `POST /agents/:ref/archive`, `POST /agents/:ref/restore` | Убрать в архив (`409 busy`, если работает), вернуть из архива |
| `GET /roles`, `POST /roles`, `GET\|PUT\|DELETE /roles/:id` | Роли (`{name, instructions, description?, color?, id?}`) |
| `POST /agents/:ref/permission/:requestId {approve}` | Решение по запросу прав |
| `GET /agents/:ref/history`, `GET /agents/:ref/stream` (SSE) | Журнал и живой поток событий агента |
| `GET /messages?agent=&since=&limit=` | Общая лента |
| `GET /inbox?wait=&peek=1&after=` | Новые сообщения для «Вы» (long-poll) |
| `GET /stream` (SSE) | Снапшот и все изменения графа и ленты |

Типы запросов, ответов и событий описаны в [`shared/types/`](shared/types). Их используют сервер, CLI и UI.

## Настройка (переменные окружения)

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `ORCH_PORT` | `4337` | Порт API и UI |
| `NESSY_ORCH_HOME` | `~/.nessy-orch` | Состояние, журналы, логи |
| `NESSY_BIN` | `~/.local/bin/nessy` | Исполняемый файл nessy |
| `NESSY_SERVE_ARGS` | — | Дополнительные аргументы `nessy serve` |
| `SERVE_BASE_PORT` | `4360` | Начало пула портов для `nessy serve` |
| `MAX_SESSIONS` | `20` | Сессий на пространство |
| `ORCH_AUTO_APPROVE` | `1` | Автоподтверждение прав агентов |
| `ORCH_MAX_HOPS` | `8` | Максимальная длина цепочки агент → агент |
| `ORCH_RATE_LIMIT` | `30` | Сообщений на пару в минуту |
| `ORCH_HEALTH_TIMEOUT_MS` | `60000` | Ожидание готовности `nessy serve` |
| `ORCH_UI_DIR` | `ui/dist` | Каталог собранного UI |
| `ORCH_SEED_ROLES` | `1` | При первом запуске (нет `roles.json`) залить готовые роли из `roles/` |

Логи: `~/.nessy-orch/logs/space-<имя>.log` (serve). При запуске через launchd лог оркестратора пишется в `orch.{out,err}.log`.

## Архитектура

Сервер работает без рантайм-зависимостей (только стандартная библиотека Node). Код разделён на слои, зависимости
направлены внутрь. Типы лежат в отдельных файлах (`types.ts`, `*.types.ts`, `ports.ts`) и не смешиваются с кодом.

```text
shared/types/            контракт сервер ⇄ CLI ⇄ UI (только типы): domain, events, api
src/
  main.ts, app.ts        точка входа и сборка зависимостей (composition root)
  lib/                   общие утилиты: безопасный разбор JSON, id, текст, async
  domain/                чистая логика без IO: маршрутизация, лимиты, граф ожиданий, статусы, план, вводная агента
  application/           сценарии: оркестратор, агенты, сообщения, пространства, шина событий, порты (интерфейсы)
    agent/               агент: очередь, ход, журнал событий
    services/            spaces / messaging / agents / roles
  infrastructure/        адаптеры портов
    nessy/               клиент nessy serve и чистый маппер событий — единственное место, знающее протокол nessy
    persistence/         state.json и roles.json (атомарно) + JSONL-журналы
    process/             запуск и контроль процессов nessy serve
    sse/, config/        SSE-парсер и форматтер, загрузка конфигурации
  interfaces/
    http/                HTTP-сервер: роутер, guard (Host/Origin), валидация тел, SSE, статика UI, routes/*
    cli/                 CLI: аргументы, клиент API, форматирование, commands/*, launchd
ui/src/                  React + Vite, Feature-Sliced Design
  app/                   корень, раскладка, горячие клавиши, стили и дизайн-токены
  pages/                 main (три колонки), roles, spaces
  widgets/               topbar, attention, tasks, agent-detail, journal
  features/              spawn-agent, add-space, role-editor, compose-message, agent-actions, permission
  entities/              task (поручения из дерева агентов), attention (очередь внимания), agent, role, message
  shared/                api-клиент, стор (SSE /stream), утилиты, UI-примитивы
test/
  unit/                  lib, domain, application, infrastructure, interfaces
  integration/           api, messaging, lifecycle, archive, roles, plan, streams, persistence, startup
  support/               тестовый стенд, фейковый nessy serve
e2e/                     Playwright: дымовые проверки UI (десктоп и телефон)
docs/                    требования и контракт nessy serve (ACP)
```

Подробнее: [docs/requirements.md](docs/requirements.md), [docs/contract/README.md](docs/contract/README.md).

## Разработка

```sh
npm run build          # сервер (очистка dist + tsc) + UI (vite)
npm run typecheck      # строгая типизация сервера и UI
npm run lint           # ESLint strictTypeChecked, запрет any
npm test               # unit + интеграционные тесты сервера (node:test, фейковый nessy)
npm run test:e2e       # дымовые e2e в Playwright (нужен npm run build и npx playwright install chromium)
npm run check          # typecheck + lint + test
npm run dev:ui         # Vite dev-сервер на :5173 с прокси на запущенный оркестратор
```

Правила кода: TypeScript strict, `any` и `@ts-ignore` запрещены линтером. Внешний JSON читается только через
хелперы `src/lib/json.ts`. В UI типы контракта импортируются как `import type … from '@contract'`.

## Ограничения

- Если оркестратор перезапустится посреди хода, обрабатываемое сообщение теряется: сохраняется только очередь.
- Форматы `nessy/error` и `prompt_cancelled` взяты из референсного кода nessy и живьём ещё не проверены.
- Аутентификации нет, доступ только с loopback.

### Если сессии не создаются (newSession timeout)

Почти всегда это окружение: nessy запущен без прокси, сертификатов или токенов, которые есть в терминале.
Проверьте, что оркестратор запущен из обычного терминала или сервисом через `install` (login shell), а не из-под
Claude Code. Проверка без оркестратора:

```sh
~/.local/bin/nessy serve --port 4399 --hostname 127.0.0.1 --no-web --workspace <каталог> &
curl -s -XPOST 127.0.0.1:4399/session -H 'content-type: application/json' -d '{"cwd":"<каталог>","sessionScope":"thread"}'
```
