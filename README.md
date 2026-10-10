# nessy-orch

Оркестратор агентов **nessy**. Главная нода («Вы» — человек и Claude Code) запускает независимых агентов nessy
в рабочих пространствах, пишет им и получает ответы. Агенты могут писать друг другу. За их работой можно следить
в приложении **Nessy Orch для macOS**: сессии, на каком шаге плана каждый агент, текущий инструмент, итоговые ответы,
источники и расход токенов.

Зачем: у nessy есть доступ к dp-инструментам (GitLab, Jira, Sage, Wiki) и долгая автономная работа в воркспейсе,
которых нет у Claude в песочнице. nessy-orch даёт простой способ делегировать nessy задачи и следить за ними.

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
- **Сессии.** Каждый Claude заводит **одну сессию на весь разговор** (`session new`), запускает в ней агентов
  (`spawn --session <id>`) и читает ответы из её inbox (`inbox --session <id>`) с отдельным курсором — несколько Claude
  работают параллельно и не забирают ответы друг друга. Агент, запущенный агентом, наследует сессию родителя.
  Завершает сессию оркестратор (`session done --summary`); приложение открывается на сессии по ссылке `nessy-orch://session/<id>`.
  Сессии хранятся в `sessions.json`. В сессии копятся **источники** (ссылки из ответов и вызовов инструментов агентов,
  `session sources <id>`) и **счётчики** (ходы, инструменты, время, токены — `AgentView.stats`).
- **Роли.** Сохранённые инструкции (`role add`), которые попадают во вводную агента: `spawn --role reviewer`.
- **Произвольный граф общения.** `Вы ↔ агент`, `агент ↔ агент`. Ответ агента автоматически уходит отправителю.
  Агенты пишут другим сами, через shell: `nessy-orch send --from <id> <кому> "текст"`.
- **Защиты.** Лимит длины цепочки (8 переходов), лимит сообщений на пару (30 в минуту), обнаружение взаимного
  ожидания (`409 deadlock`), проверка `Host`/`Origin` (защита от DNS-rebinding и CSRF из браузера).
- **Права.** По умолчанию запросы прав подтверждаются автоматически (с записью в журнал агента). При
  `ORCH_AUTO_APPROVE=0` запросы ждут решения в приложении или через API.
- **Устойчивость.** Падение `nessy serve` или рестарт оркестратора — сессия агента восстанавливается при следующем
  обращении. Состояние и роли пишутся атомарно в `~/.nessy-orch/`.
- **Веб-интерфейс** — панель наблюдения: таблица агентов («Работают» / «Выполнено») с прогрессом по плану, текущим
  инструментом и таймером, детали с планом, шагами и итоговым ответом. Из действий — только «Остановить» и
  «Разрешить / Отклонить». Работает на десктопе и телефоне.
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
npm run demo                        # сборка + оркестратор с фейковым nessy + демо-данные
npm run demo:seed                   # только демо-данные — к уже запущенному оркестратору (ORCH_PORT)
```

`npm run demo` вместе с сервером запускает [`scripts/demo-seed.mjs`](scripts/demo-seed.mjs): дождавшись
оркестратора, он через API заводит две сессии двух «Claude» — `demo-fix-ci` (владелец `claude-1`, три агента:
разведка, исполнитель с запросом разрешения, проверяющий) и `demo-review-mr` (`claude-2`: ревьюер, запущенный им
агент безопасности — наследует сессию — и аналитик Jira). Агенты идут по сценариям `#work` с планом, ответы — в
формате «Итог / Детали / Источники». Открыть в приложении: `open nessy-orch://session/demo-fix-ci`. Повторный запуск
сессии с теми же id не дублирует; чистый старт — удалить `${TMPDIR:-/tmp}/nessy-orch-demo`.

Команды фейкового агента (в тексте задачи): `#tools` — серия вызовов инструментов, `#long` — длинный markdown-ответ
потоком, `#shell <команда>` — инструмент shell, `#perm` — запрос прав, `#slow` — долгий ход (можно прервать),
`#error` — ошибка хода, `#fail` — падение сессии, `#relay <кому> <текст>` — сообщение другому агенту,
`#work[~] K шаг => Tool: арг; … || ответ` — план из шагов: первые K пройдены, на следующем агент «работает»
(`~` — идёт дальше сам, `?` перед инструментом — сначала запрос разрешения). Любой другой текст возвращается эхом.
Сессии и агентов создаёт Claude через CLI или API (`POST /agents`) — само приложение агентов не запускает.

## Приложение для macOS

Нативное приложение (SwiftUI, macOS 26, Liquid Glass) в [`app/`](app/): **только наблюдает** за агентами, которых запускают
Claude через CLI. Человек может разрешить или отклонить запрос прав, остановить ход агента и завершить сессию.
Дизайн и решения — [docs/design/](docs/design/), исследование аналогов — [docs/research-orchestrators.md](docs/research-orchestrators.md).

| Зона | Что там |
|---|---|
| **Сайдбар** | Сессии: активные сверху, завершённые свёрнуты; признак «ждёт вас» и «новое» |
| **Сессия → вкладки** | **Агенты** (список: состояние, на каком шаге плана, что делает сейчас, таймер, запрос прав прямо в строке) · **Источники** (все ссылки, которыми пользовались агенты, по хостам, с поиском) · **Статистика** (ходы, вызовы инструментов, время, токены по агентам) |
| **Окно агента** | Плавающее окно справа (не шторка): «Итог» (решение, этап, ответ, источники, счётчики) и «Журнал» (Сводка / Обычный / Подробный) |
| **Menu bar** | Значок со счётчиком, панель: что ждёт вас (кнопки «Разрешить / Отклонить»), кто работает |
| **Уведомления** | Запрос прав (с кнопками), агент заблокирован, ошибка, сессия завершена |

Ссылки: `nessy-orch://session/<id>`, `nessy-orch://agent/<id>`; `nessy-orch open [<id сессии>]` открывает приложение.
Сборка и запуск:

```sh
cd app
swift test                       # тесты NessyKit (модель, SSE, состояние, логика списков)
scripts/build-app.sh --run       # release-сборка «Nessy Orch.app» (ad-hoc подпись) и запуск
defaults write com.nessy.orch.app serverURL "http://127.0.0.1:4338"   # другой адрес оркестратора (демо и т.п.)
```

План агенты публикуют сами (`nessy-orch plan --from <id> "- [x] …" "- [ ] …"`) или он приходит из протокола nessy
(ACP `plan`). План желателен, но не обязателен: без него приложение показывает последний инструмент и время.

## CLI

```text
nessy-orch session new "<заголовок>" [--owner X] [--id slug]   # один раз на разговор: id и ссылка nessy-orch://session/<id>
nessy-orch session ls [--all] | session show <id> | session sources <id> | session reopen <id> | session rm <id>
nessy-orch session done <id> [--summary "…" | --summary-file F]
nessy-orch spawn [--session S] [--space S] [--name N] [--role R] [--wait] [--timeout СЕК] ["задача"]
nessy-orch send <агент|you> "текст" [--wait] [--queue] [--timeout СЕК] [--from ID]
nessy-orch ask <путь|space> "задача" [--session S]   # = spawn --wait
nessy-orch ls [--all] [--session S] | show <агент> | watch <агент> | cancel <агент> | kill <агент>
nessy-orch archive <агент> | restore <агент>
nessy-orch plan <агент> | plan --from <свой id> "- [x] …" "- [~] …" "- [ ] …" [--clear]   # план агента: показать | опубликовать (агент сам)
nessy-orch role ls | role add <имя> --instructions "…" | --file <путь> [--description D] [--id ID] | role show <id> | role rm <id>
nessy-orch role import [путь] [--force] [--dry-run]   # роли из markdown-файлов (по умолчанию roles/); role export <id> [--out файл]
nessy-orch feed [-n 30] [--follow]
nessy-orch inbox [--session S] [--wait СЕК] [--peek]    # --session — ответы агентов сессии, свой курсор на сессию
nessy-orch space add <путь> [--name N] [--url URL] | space ls | space rm <имя> [--force]
nessy-orch status | open [<id сессии>] | install [--print] | uninstall
```

Полезный результат (ответ агента, JSON) выводится в stdout, служебные сообщения — в stderr. Флаг `--json` есть у всех
команд. `send` работающему агенту прерывает его ход (`--queue` — дождаться очереди). `ls` скрывает агентов в архиве,
`ls --all` показывает всех. `--session` у `spawn`, `ask`, `ls`, `inbox` по умолчанию берётся из `NESSY_ORCH_SESSION`.
`session rm` отказывает (`409 session_busy`), пока в сессии работают агенты; агенты удалённой сессии остаются вне сессий.
Старые алиасы `nessy-ask`, `nessy-jobs`, `nessy-watch` оставлены для совместимости.

## Плагин для Claude Code

Репозиторий — маркетплейс плагинов Claude Code (`.claude-plugin/marketplace.json`) с одним плагином `nessy`
в [`plugins/nessy/`](plugins/nessy/). Плагин переводит Claude в роль ведущего: работая через nessy-orch, Claude
не выполняет задачу сам, а проходит цикл:

0. Заводит сессию **один раз на разговор** (`session new "<цель>" --owner claude`) и сразу пишет пользователю ссылку на неё:
   `nessy-orch://session/<id>` (открывается в приложении). Смена темы сессию не меняет.
1. Осматривается: `ls --all --session <id>`, `role ls` (ролей нет — `role import`).
2. Оценивает объём и делит задачу на независимые части.
3. Подбирает для каждой части роль.
4. Пишет самодостаточное поручение: цель, контекст, границы, источники, формат результата, критерий готовности.
5. Запускает агентов в сессии (`spawn --session <id>`, независимые части параллельно) и собирает ответы фоновым
   `inbox --session <id> --wait` (один сборщик на сессию)
   (`run_in_background`): пока агенты работают, Claude не «замерзает» и продолжает разговор, а ответ приходит
   уведомлением. Ход смотрит по плану агента (`plan`), если агент его ведёт.
6. Проверяет результат отдельным агентом-`verifier`.
7. Сводит итог пользователю; когда разговор закончен — закрывает сессию: `session done <id> --summary "<итог>"`.

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

#### Без плагина: `scripts/install.sh`

Скрипт кладёт скиллы из `plugins/nessy/skills` в любой каталог скиллов — Claude Code (`.claude/skills`) или
nessy (`.nessy/skills`, устроен так же), глобально или в проект. По умолчанию ставит симлинки, поэтому
`git pull` обновляет скиллы сам. Чужие скиллы с теми же именами не трогает.

```bash
scripts/install.sh                          # ~/.claude/skills
scripts/install.sh nessy                    # ~/.nessy/skills
scripts/install.sh claude --project ~/Projects/shippy   # ~/Projects/shippy/.claude/skills
scripts/install.sh nessy --project ~/Projects/shippy    # ~/Projects/shippy/.nessy/skills
scripts/install.sh --dir ~/somewhere/skills # произвольный каталог
scripts/install.sh --only nessy-orch,code-question --copy   # выборочно и копиями
scripts/install.sh nessy --uninstall        # удалить
scripts/install.sh --list                   # что есть
```

То же через npm: `npm run skills:install -- nessy --project <путь>`. При установке скиллами (а не плагином)
они вызываются без префикса: `/nessy-orch`, `/code-question` и т. д.

### Что внутри

| Компонент | Вызов | Что делает |
|---|---|---|
| Скилл `nessy-orch` | `/nessy:nessy-orch`, загружается сам | Цикл оркестратора, выбор роли, шаблон поручения, правила, «красные флаги», ошибки; `references/commands.md` — справочник команд, `references/briefs.md` — общие схемы и указатель рецептов |
| Скилл `code-question` | `/nessy:code-question` | Вопрос по коду чужого репозитория: `code-explorer` (+ `verifier`) |
| Скилл `mr-review` | `/nessy:mr-review` | Ревью MR: `gitlab-mr-reviewer` ‖ `jira-analyst` (+ `security-reviewer`), черновики комментариев без публикации |
| Скилл `incident` | `/nessy:incident` | Инцидент: `debugger` ‖ `wiki-researcher` / `jira-analyst`, хронология и гипотезы |
| Скилл `jira-report` | `/nessy:jira-report` | Сводка задач Jira таблицей: `jira-analyst` |
| Скилл `implement` | `/nessy:implement` | Изменение кода: `analyst` → `executor` → `verifier` |
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
| `GET /health`, `GET /status`, `GET /graph` | Служебное: здоровье, состояние, пространства, агенты, роли и задачи |
| `GET /sessions?status=`, `POST /sessions {title,owner?,id?}` | Сессии оркестраторов; id по умолчанию — slug заголовка + 4 hex (`409 session_exists` при занятом) |
| `GET /sessions/:id`, `PATCH /sessions/:id {title?,status?,summary?}`, `DELETE /sessions/:id` | Сессия: правка/закрытие (`status: done`), удаление (`409 session_busy`, если агенты работают; агенты → `session: null`) |
| `GET /sessions/:id/sources` | Источники сессии: ссылки из ответов и вызовов инструментов агентов, без дублей |
| `GET /spaces`, `POST /spaces {path,name?,url?}`, `DELETE /spaces/:name?force=1` | Пространства |
| `GET /agents?session=`, `POST /agents {space?,name?,role?,session?,prompt?,parent?,from?,wait?}` | Список (включая архивных; `session` — только агенты сессии) и создание агентов (`404 no_session`; без `session` — сессия родителя) |
| `GET /agents/:ref`, `DELETE /agents/:ref` | Агент |
| `POST /agents/:ref/send {text,from?,interrupt?,wait?}`, `POST /agents/:ref/cancel` | Сообщение (от «Вы» по умолчанию прерывает ход), прервать ход |
| `POST /agents/:ref/plan {from?,entries}`, `DELETE /agents/:ref/plan` | План агента (публикует сам агент; чужой `from` → `403`) |
| `POST /agents/:ref/archive`, `POST /agents/:ref/restore` | Убрать в архив (`409 busy`, если работает), вернуть из архива |
| `GET /roles`, `POST /roles`, `GET\|PUT\|DELETE /roles/:id` | Роли (`{name, instructions, description?, color?, id?}`) |
| `POST /agents/:ref/permission/:requestId {approve}` | Решение по запросу прав |
| `GET /agents/:ref/history`, `GET /agents/:ref/stream` (SSE) | Журнал и живой поток событий агента |
| `GET /messages?agent=&since=&limit=` | Общая лента |
| `GET /inbox?wait=&peek=1&after=&session=` | Новые ответы для «Вы» (long-poll); с `session` — только от агентов сессии, со своим курсором |
| `GET /stream` (SSE) | Снапшот (с `sessions`) и все изменения графа и ленты (в том числе `session` / `session_removed`) |

Типы запросов, ответов и событий описаны в [`shared/types/`](shared/types). Их используют сервер, CLI и приложение (в Swift они продублированы в `app/Sources/NessyKit/Models.swift`).

## Настройка (переменные окружения)

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `ORCH_PORT` | `4337` | Порт API |
| `NESSY_ORCH_HOME` | `~/.nessy-orch` | Состояние, журналы, логи |
| `NESSY_BIN` | `~/.local/bin/nessy` | Исполняемый файл nessy |
| `NESSY_SERVE_ARGS` | — | Дополнительные аргументы `nessy serve` |
| `SERVE_BASE_PORT` | `4360` | Начало пула портов для `nessy serve` |
| `MAX_SESSIONS` | `20` | Сессий на пространство |
| `ORCH_AUTO_APPROVE` | `1` | Автоподтверждение прав агентов |
| `ORCH_MAX_HOPS` | `8` | Максимальная длина цепочки агент → агент |
| `ORCH_RATE_LIMIT` | `30` | Сообщений на пару в минуту |
| `ORCH_HEALTH_TIMEOUT_MS` | `60000` | Ожидание готовности `nessy serve` |
| `ORCH_SEED_ROLES` | `1` | При первом запуске (нет `roles.json`) залить готовые роли из `roles/` |

Логи: `~/.nessy-orch/logs/space-<имя>.log` (serve). При запуске через launchd лог оркестратора пишется в `orch.{out,err}.log`.

## Архитектура

Сервер работает без рантайм-зависимостей (только стандартная библиотека Node). Код разделён на слои, зависимости
направлены внутрь. Типы лежат в отдельных файлах (`types.ts`, `*.types.ts`, `ports.ts`) и не смешиваются с кодом.

```text
shared/types/            контракт сервер ⇄ CLI ⇄ приложение (только типы): domain, events, api
src/
  main.ts, app.ts        точка входа и сборка зависимостей (composition root)
  lib/                   общие утилиты: безопасный разбор JSON, id, текст, async
  domain/                чистая логика без IO: маршрутизация, лимиты, граф ожиданий, статусы, план, вводная агента
  application/           сценарии: оркестратор, агенты, сообщения, пространства, шина событий, порты (интерфейсы)
    agent/               агент: очередь, ход, журнал событий
    services/            spaces / messaging / agents / roles / sessions / sources
  infrastructure/        адаптеры портов
    nessy/               клиент nessy serve и чистый маппер событий — единственное место, знающее протокол nessy
    persistence/         state.json, roles.json и sessions.json (атомарно) + JSONL-журналы (события агентов, лента, sources/<сессия>.jsonl)
    process/             запуск и контроль процессов nessy serve
    sse/, config/        SSE-парсер и форматтер, загрузка конфигурации
  interfaces/
    http/                HTTP-сервер: роутер, guard (Host/Origin), валидация тел, SSE, статика UI, routes/*
    cli/                 CLI: аргументы, клиент API, форматирование, commands/*, launchd
app/                     нативное приложение macOS (SwiftPM): NessyKit (модель, API, SSE, состояние) и NessyOrch (SwiftUI)
test/
  unit/                  lib, domain, application, infrastructure, interfaces
  integration/           api, messaging, lifecycle, archive, roles, plan, streams, persistence, startup, sessions
  support/               тестовый стенд, фейковый nessy serve
docs/                    требования, контракт nessy serve (ACP), дизайн приложения, исследование аналогов
```

Подробнее: [docs/requirements.md](docs/requirements.md), [docs/contract/README.md](docs/contract/README.md).

## Разработка

```sh
npm run build          # сервер (очистка dist + tsc)
npm run typecheck      # строгая типизация сервера
npm run lint           # ESLint strictTypeChecked, запрет any
npm test               # unit + интеграционные тесты сервера (node:test, фейковый nessy)
npm run check          # typecheck + lint + test
(cd app && swift test)  # тесты NessyKit
```

Правила кода: TypeScript strict, `any` и `@ts-ignore` запрещены линтером. Внешний JSON читается только через
хелперы `src/lib/json.ts`.

## Ограничения

- Если оркестратор перезапустится посреди хода, ответа на это сообщение не будет: отправитель получит ответ с ошибкой «оркестратор был перезапущен во время хода», очередь сохраняется.
- Токены берутся из `usage` в `turn_complete` и из `GET /session/:id/stats`; точная форма этих ответов nessy не зафиксирована, разбор по именам полей и живьём не проверен.
- Веб-интерфейс (`ui/`, `e2e/`) выведен из сборки и не поддерживается.
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
