# nessy-orch

Оркестратор агентов **nessy**. Главная нода («Вы» — человек и Claude Code) запускает независимых агентов nessy
в рабочих пространствах, пишет им и получает ответы. Агенты могут писать друг другу. Вся переписка видна в одной
общей ленте, состояние — в живом графе.

Зачем: у nessy есть доступ к dp-инструментам (GitLab, Jira, Sage, Wiki) и долгая автономная работа в воркспейсе,
которых нет у Claude в песочнице. nessy-orch даёт простой способ делегировать nessy задачи и следить за ними.

![Граф, ростер и общая лента](docs/screenshots/desktop-dark.png)

## Возможности

- **Пространства (spaces).** Пространство = каталог-воркспейс + процесс `nessy serve`, который запускает оркестратор
  (managed), либо уже запущенный демон по URL (external). Порты выделяются автоматически.
- **Агенты.** Каждый агент — независимая сессия nessy (`sessionScope: thread`). У агента есть очередь сообщений:
  пока он работает, новые сообщения ждут, порядок и авторство сохраняются, очередь переживает рестарт.
- **Произвольный граф общения.** `Вы ↔ агент`, `агент ↔ агент`. Ответ агента автоматически уходит отправителю.
  Агенты пишут другим сами, через shell: `nessy-orch send --from <id> <кому> "текст"`.
- **Защиты.** Лимит длины цепочки (8 переходов), лимит сообщений на пару (30 в минуту), обнаружение взаимного
  ожидания (`409 deadlock`), проверка `Host`/`Origin` (защита от DNS-rebinding и CSRF из браузера).
- **Права.** По умолчанию запросы прав подтверждаются автоматически (с записью в журнал агента). При
  `ORCH_AUTO_APPROVE=0` запросы ждут решения в UI или через API.
- **Устойчивость.** Падение `nessy serve` — агенты засыпают и восстанавливают сессию при следующем обращении.
  Состояние пишется атомарно в `~/.nessy-orch/`.
- **Веб-интерфейс** — граф-сонар, общая лента и чат с каждым агентом. Работает на десктопе, планшете и телефоне.
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

Чтобы оркестратор работал постоянно, установите его как сервис launchd (macOS, `KeepAlive`):

```sh
bin/nessy-orch install              # --print — только показать plist
bin/nessy-orch uninstall
```

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

| Зона | Что там |
|---|---|
| **Верхняя панель** | Статус соединения, счётчики (агенты, работают, ждут разрешения), пространства (клик — путь, URL, удаление), кнопки «Пространство» и «Агент», тема |
| **Ростер** (слева) | Агенты по пространствам: статус, текущий инструмент, таймер хода, очередь, запросы прав, поиск |
| **Граф-сонар** (центр) | «Вы» в центре, агенты — узлы цвета своего пространства. Рёбра — кто кого создал и кто кому писал. Каждое сообщение пролетает по ребру светящимся «пакетом». Масштаб, перетаскивание, подгонка |
| **Общая лента** (справа) | Групповой чат всех сообщений: кто → кому, ответы, ожидание ответа, недоставленные, системные события. Фильтры, поле отправки с выбором адресата (`@имя`) |
| **Чат агента** | Клик по агенту. Входящие сообщения, ответ потоком, размышления, карточки инструментов (ввод и вывод), запросы прав с кнопками, прервать ход, удалить агента |

Адаптивность: на ширине ≥ 1280 px видны три колонки. На 900–1279 px ростер выезжает поверх графа. На экранах уже
900 px остаётся одна колонка и нижние вкладки «Граф / Агенты / Лента / Чат», диалоги открываются нижним листом.
Есть тёмная (сонар) и светлая (бумажная карта) темы. Анимации отключаются при `prefers-reduced-motion`.

Горячие клавиши: `N` — новый агент, `S` — новое пространство, `/` — к полю ввода, `Esc` — закрыть чат агента,
`Enter` — отправить, `Shift+Enter` — перенос строки.

## CLI

```text
nessy-orch spawn [--space S] [--name N] [--wait] [--timeout СЕК] ["задача"]
nessy-orch send <агент|you> "текст" [--wait] [--timeout СЕК] [--from ID]
nessy-orch ask <путь|space> "задача"          # = spawn --wait
nessy-orch ls | show <агент> | watch <агент> | cancel <агент> | kill <агент>
nessy-orch feed [-n 30] [--follow]
nessy-orch inbox [--wait СЕК] [--peek]
nessy-orch space add <путь> [--name N] [--url URL] | space ls | space rm <имя> [--force]
nessy-orch status | open | install [--print] | uninstall
```

Полезный результат (ответ агента, JSON) выводится в stdout, служебные сообщения — в stderr. Флаг `--json` есть у всех
команд. Старые алиасы `nessy-ask`, `nessy-jobs`, `nessy-watch` оставлены для совместимости.

## HTTP API

`127.0.0.1:4337`, JSON, без аутентификации (только loopback).

| Метод и путь | Назначение |
|---|---|
| `GET /health`, `GET /status`, `GET /graph` | Служебное: здоровье, состояние, пространства и агенты |
| `GET /spaces`, `POST /spaces {path,name?,url?}`, `DELETE /spaces/:name?force=1` | Пространства |
| `GET /agents`, `POST /agents {space?,name?,prompt?,parent?,from?,wait?}` | Список и создание агентов |
| `GET /agents/:ref`, `DELETE /agents/:ref` | Агент |
| `POST /agents/:ref/send {text,from?,wait?}`, `POST /agents/:ref/cancel` | Сообщение, прервать ход |
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

Логи: `~/.nessy-orch/logs/space-<имя>.log` (serve). При запуске через launchd лог оркестратора пишется в `orch.{out,err}.log`.

## Архитектура

Сервер работает без рантайм-зависимостей (только стандартная библиотека Node). Код разделён на слои, зависимости
направлены внутрь. Типы лежат в отдельных файлах (`types.ts`, `*.types.ts`, `ports.ts`) и не смешиваются с кодом.

```text
shared/types/            контракт сервер ⇄ CLI ⇄ UI (только типы): domain, events, api
src/
  main.ts, app.ts        точка входа и сборка зависимостей (composition root)
  lib/                   общие утилиты: безопасный разбор JSON, id, текст, async
  domain/                чистая логика без IO: маршрутизация, лимиты, граф ожиданий, статусы, вводная агента
  application/           сценарии: оркестратор, агенты, сообщения, пространства, шина событий, порты (интерфейсы)
    agent/               агент: очередь, ход, журнал событий
    services/            spaces / messaging / agents
  infrastructure/        адаптеры портов
    nessy/               клиент nessy serve и чистый маппер событий — единственное место, знающее протокол nessy
    persistence/         state.json (атомарно) + JSONL-журналы
    process/             запуск и контроль процессов nessy serve
    sse/, config/        SSE-парсер и форматтер, загрузка конфигурации
  interfaces/
    http/                HTTP-сервер: роутер, guard (Host/Origin), валидация тел, SSE, статика UI, routes/*
    cli/                 CLI: аргументы, клиент API, форматирование, commands/*, launchd
ui/src/                  React + Vite, Feature-Sliced Design
  app/                   корень, раскладка, горячие клавиши, стили и дизайн-токены
  widgets/               topbar, roster, graph, feed, agent-chat, tabbar
  features/              spawn-agent, add-space, compose-message, agent-actions, permission
  entities/              agent (статусы, аватар, поток событий), message (пузыри, markdown)
  shared/                api-клиент, стор (SSE /stream), утилиты, UI-примитивы
test/
  unit/                  lib, domain, application, infrastructure, interfaces
  integration/           api, messaging, lifecycle, streams, persistence
  support/               тестовый стенд, фейковый nessy serve
e2e/                     Playwright: сценарии UI и адаптивность на 5 размерах экрана
docs/                    требования и контракт nessy serve (ACP)
```

Подробнее: [docs/requirements.md](docs/requirements.md), [docs/contract/README.md](docs/contract/README.md).

## Разработка

```sh
npm run build          # сервер (tsc) + UI (vite)
npm run typecheck      # строгая типизация сервера и UI
npm run lint           # ESLint strictTypeChecked, запрет any
npm test               # unit + интеграционные тесты сервера (node:test, фейковый nessy)
npm run test:e2e       # e2e UI в Playwright (нужен npm run build и npx playwright install chromium)
npm run check          # typecheck + lint + test
npm run dev:ui         # Vite dev-сервер на :5173 с прокси на запущенный оркестратор
```

Правила кода: TypeScript strict, `any` и `@ts-ignore` запрещены линтером. Внешний JSON читается только через
хелперы `src/lib/json.ts`. В UI типы контракта импортируются как `import type … from '@contract'`.

## Ограничения

- Если оркестратор перезапустится посреди хода, обрабатываемое сообщение теряется: сохраняется только очередь.
- Форматы `nessy/error` и `prompt_cancelled` взяты из референсного кода nessy и живьём ещё не проверены.
- Аутентификации нет, доступ только с loopback.
