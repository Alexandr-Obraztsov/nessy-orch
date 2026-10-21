# nessy-orch

Оркестратор агентов **nessy**. Главная нода («Вы» — человек и Claude Code) запускает независимых агентов nessy
в рабочих пространствах, пишет им и получает ответы. Агенты могут писать друг другу. За их работой можно следить
в приложении **TClaude-Orch для macOS**: сессии, на каком шаге плана каждый агент, текущий инструмент, итоговые ответы,
источники и расход токенов.

Зачем: у nessy есть доступ к dp-инструментам (GitLab, Jira, Sage, Wiki) и долгая автономная работа в воркспейсе,
которых нет у Claude в песочнице. nessy-orch даёт простой способ делегировать nessy задачи и следить за ними.

## Возможности

- **Пространства (spaces).** Пространство = каталог-воркспейс + процесс `nessy serve`, который запускает оркестратор
  (managed), либо уже запущенный демон по URL (external). Порты выделяются автоматически.
- **Агенты.** Каждый агент — независимая сессия nessy (`sessionScope: thread`). Статусы простые: `starting`,
  `working`, `idle`, `error`. У агента есть очередь сообщений: сообщения агентов друг другу ждут своей очереди,
  а сообщение работающему агенту его не прерывает: оно уходит в идущий ход (агент увидит его между шагами), не приняли — встаёт в очередь (`send --interrupt` — прервать и доставить первым).
  Очередь переживает рестарт.
- **Архив.** Агент, успешно закончивший задачу, уходит в архив: он скрыт из рабочего списка, но сессия и контекст
  сохранены. Любое сообщение будит его, поэтому к агенту по имени можно вернуться в любой момент. Ход с ошибкой
  оставляет агента на виду; упавшая сессия пересоздаётся при следующем сообщении.
- **Сессии.** Вкладка приложения = **одна сессия** (её создаёт приложение, `NESSY_ORCH_SESSION`; вне приложения Claude заводит
  `session new`). Агенты запускаются в ней (`spawn`), несколько Claude работают параллельно, каждый в своей сессии. Ящика входящих нет:
  `spawn` и `send` сами ждут ответ агента и печатают его (запускаются в фоне, Claude Code будит по завершении). Агент, запущенный агентом,
  наследует сессию родителя. Приложение открывается на сессии по ссылке `nessy-orch://session/<id>`. Лишнее убирается само: агентов не больше 20
  (простаивающих сверх лимита удаляет сервер, самых давних первыми), сессий не больше 10.
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
- **CLI** — единый бинарь `nessy-orch`: предсказуемый вывод, `--json`, блокирующий (`--wait`) и фоновый режимы.

## Быстрый старт

Нужен Node.js ≥ 20 и установленный `nessy` (по умолчанию `~/.local/bin/nessy`).

```sh
cd ~/Projects/nessy-orch
npm install
npm run build                       # сервер (TypeScript → dist/)
node dist/src/main.js               # оркестратор на http://127.0.0.1:4337
```

Оркестрацию показывает приложение TClaude-Orch (`bin/nessy-orch open` открывает его на сессии).

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
bin/nessy-orch spawn --space shippy --title "Обзор README" "посмотри README и скажи, что это"
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

Нативное приложение (SwiftUI, macOS 26, Liquid Glass) в [`app/`](app/): терминал с Claude Code в любой папке и наблюдение за агентами
сессии. Человек может остановить ход агента, написать ему и завершить сессию.
Дизайн и решения — [docs/design/](docs/design/), исследование аналогов — [docs/research-orchestrators.md](docs/research-orchestrators.md).

| Зона | Что там |
|---|---|
| **Окно** | Одно окно, в нём проекты: у каждого терминал (SwiftTerm, в нём сразу Claude Code в папке проекта) и сессии оркестратора по чатам Claude. Папка открывается из любого места: `nessy-orch .`, `open -a "TClaude-Orch" .`, Finder, перетаскиванием на значок, ⌘N / ⇧⌘O. Хуки Claude и CLI приходят с плагином nessy, который приложение кладёт в `~/.claude/skills/nessy` |
| **Боковая панель** | Субагенты сессии: список (состояние, роль, последняя команда) → карточка агента (цель, план, чат или итог с источниками, поле ввода, ↩ отправить). Внизу связь, состояние Claude (по хукам), кнопки «Роли» и «⋯» |
| **Menu bar** | Значок со счётчиком, панель: кому нужно внимание, кто работает, активные сессии (открыть окно) |
| **Уведомления** | Запрос прав (с кнопками), агент заблокирован, ошибка, сессия завершена |

**Плагин и служба из приложения.** В `.app` встроены сервер и плагин nessy (скилл `nessy-orch`, CLI `nessy-orch` в `bin/`, хук Stop). При запуске
приложение копирует плагин в `~/.claude/skills/nessy` (Claude Code загружает его как `nessy@skills-dir` при любом запуске `claude`; обновляется вместе
с приложением) и, если оркестратор не запущен, ставит службу launchd из встроенной копии. Нужен только Node.js ≥ 20. Статус и кнопки — в Настройках →
«Claude Code». Репозиторий клонировать не нужно.

Ссылки: `nessy-orch://session/<id>`, `nessy-orch://agent/<id>`; `nessy-orch open [<id сессии>]` открывает приложение.
Сборка и запуск:

```sh
cd app
swift test                       # тесты NessyKit (модель, SSE, состояние, логика списков)
scripts/build-app.sh --run       # release-сборка «TClaude-Orch.app» (ad-hoc подпись) и запуск
defaults write com.nessy.orch.app serverURL "http://127.0.0.1:4338"   # другой адрес оркестратора (демо и т.п.)
```

План агенты публикуют сами (`nessy-orch plan --from <id> "- [x] …" "- [ ] …"`) или он приходит из протокола nessy
(ACP `plan`). План желателен, но не обязателен: без него приложение показывает последний инструмент и время.

## CLI

```text
nessy-orch session new "<заголовок>" [--owner X] [--id slug]   # один раз на разговор: id и ссылка nessy-orch://session/<id>
nessy-orch session ls [--all] | session show <id> | session sources <id> | session reopen <id> | session rm <id>
nessy-orch session done <id> [--summary "…" | --summary-file F]
nessy-orch spawn [--session S] [--space S] [--name N] [--title "заголовок"] [--role R] [--no-wait] [--timeout СЕК] "задача"   # ждёт ответ и печатает его (в фоне)
nessy-orch send <агент|you> "текст" [--no-wait] [--interrupt] [--timeout СЕК] [--from ID]   # ждёт ответ (агент с --from по умолчанию не ждёт)
nessy-orch wait <агент> [--timeout СЕК]   # дождаться, пока агент освободится, и вывести его последний ответ (код 3 — ещё работает)
nessy-orch ask <путь|space> "задача" [--session S]   # spawn в другом каталоге
nessy-orch ls [--all] [--session S] | show <агент> | watch <агент> | cancel <агент> | kill <агент>
nessy-orch archive <агент> | restore <агент>
nessy-orch plan <агент> | plan --from <свой id> "- [x] …" "- [~] …" "- [ ] …" [--clear]   # план агента: показать | опубликовать (агент сам)
nessy-orch role ls | role add <имя> --instructions "…" | --file <путь> [--description D] [--id ID] [--color 0..360|blue|синий] [--icon SF-Symbol] | role show <id> | role rm <id>
nessy-orch role set <id> [--name N] [--description D] [--instructions "…" | --file путь] [--color …] [--icon …]   # частичная правка
nessy-orch role import [путь] [--force] [--dry-run]   # роли из markdown-файлов (по умолчанию roles/); role export <id> [--out файл]
nessy-orch feed [-n 30] [--follow]
nessy-orch space add <путь> [--name N] [--url URL] | space ls | space rm <имя> [--force]
nessy-orch . | nessy-orch app [папка]   # открыть приложение с терминалом в этой папке (nessy-orch ~/proj тоже работает)
nessy-orch status | open [<id сессии>] | install [--print] | uninstall
```

Полезный результат (ответ агента, JSON) выводится в stdout, служебные сообщения — в stderr. Флаг `--json` есть у всех
команд. `send` работающему агенту его не прерывает (`--interrupt` — прервать). `ls` скрывает агентов в архиве,
`ls --all` показывает всех. `--session` у `spawn`, `ask`, `ls` по умолчанию берётся из `NESSY_ORCH_SESSION`.
`session rm` отказывает (`409 session_busy`), пока в сессии работают агенты; агенты удалённой сессии остаются вне сессий.

```text
nessy-orch learn [status] | on | off [--session S] | run [--session S] | backfill [--all | <id…>] | journal [--revert <id>]   # фоновое обучение
nessy-orch playbook ls | show <id> | review <id> | approve <id> | reject <id> [--reason R] | revert <id> --version N | rm <id> | note <id> "…"   # плейбуки
nessy-orch playbook edits <id> | accept <id> <hash> | reject <id> <hash>   # правки улучшателя, ждущие решения при autoReview: false (хэш можно сокращать от 4 знаков)
nessy-orch case note <id> "…"   # заметки пользователя кейса
nessy-orch case ls | show <id> | rm <id> | rebuild <id>
```

## Плагин для Claude Code

Плагин Claude Code `nessy` лежит в [`plugins/nessy/`](plugins/nessy/): один скилл, команда `/nessy:status`, три хука и CLI в `bin/`. Все хуки работают только в терминале приложения (задан `NESSY_ORCH_SESSION`). Хук SessionStart привязывает чат Claude к сессии: после `/clear` и `/resume` чат другой, поэтому сессия всегда новая (или найденная по этому чату), а вкладка приложения идёт за ней по цепочке `successor`; новый id хук записывает в `CLAUDE_ENV_FILE`, и Bash-команды Claude работают в нужной сессии. В ответе он велит Claude первым делом загрузить скилл `nessy:nessy-orch` (и снова после сжатия разговора). Хук PreToolUse на `Agent` отклоняет первый вызов своего субагента в ходе пользователя с напоминанием поручить работу агенту nessy; повторный вызов в том же ходе проходит. Хук UserPromptSubmit (`nessy-orch hook prompt`) спрашивает у сервера подсказку плейбука обучения (`POST /learning/hint`) с бюджетом 1,5 с (таймаут хука в `hooks.json` — 5 с); есть подходящий плейбук — печатает `additionalContext` с просьбой загрузить `nessy-playbooks:<id>` инструментом Skill, а ошибка, таймаут или пустой ответ дают молчание и код 0.
Главный агент здесь только Claude Code (`claude`, `tclaude`…); исполнители — агенты nessy. Плагин переводит Claude в роль ведущего: работая через
nessy-orch, Claude не выполняет задачу сам, а проходит цикл:

1. Сессия уже есть: приложение создаёт её для вкладки (`POST /sessions {cwd, chatId}`) и кладёт id в `NESSY_ORCH_SESSION`. Вне приложения
   Claude заводит сессию сам: `session new "<цель>"`, один раз на разговор.
2. Осматривается: `ls --all`, `role ls` (ролей нет: `role import`).
3. Делит задачу на **много маленьких** независимых частей (у агентов малое окно контекста): одна цель, один источник, один блок кода на агента.
   Новая задача отдаётся новому агенту с чистым контекстом; уже работавшему пишут только уточнение той же задачи (колонка «КОНТЕКСТ» в `ls`).
4. Пишет самодостаточное поручение: цель, контекст, границы, источники, формат результата, критерий готовности. Подбирает роль.
5. Запускает каждого агента отдельной командой `spawn` **в фоне** (Bash `run_in_background`): команда ждёт ответ своего агента и печатает его,
   Claude Code будит Claude по завершении. Независимое запускается параллельно; пока агенты работают, Claude продолжает разговор.
   Ничего не опрашивается: ни циклов, ни `sleep`, ни ящика входящих. Не дождались за 25 минут (код 3): `wait <агент>`.
6. Проверяет результат отдельным агентом-`verifier`, сводит итог пользователю.

Каждый агент с ролью заканчивает ответ статусом `DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT`, и Claude
решает по нему, что делать дальше. Запись во внешние системы (комментарии в GitLab, правки в Jira) разрешена
только по прямой просьбе пользователя. Ход агента, оборвавшийся любой ошибкой nessy (в том числе нет соединения), оркестратор повторяет сам
(`ORCH_TURN_RETRIES`, по умолчанию 2).

### Установка

Ставить ничего не нужно: приложение TClaude-Orch при запуске копирует плагин в `~/.claude/skills/nessy`, и Claude Code загружает его как
`nessy@skills-dir` при любом запуске `claude`. Для разработки плагина: `claude --plugin-dir plugins/nessy`; проверить манифест:
`claude plugin validate plugins/nessy`.

### Что внутри

| Компонент | Вызов | Что делает |
|---|---|---|
| Скилл `nessy-orch` | `/nessy:nessy-orch`, загружается сам | Правила оркестратора: декомпозиция на малых агентов, поручения, ожидание, итог; типовые связки ролей (MR, инцидент, Jira, код); `references/commands.md` — справочник команд |
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

## Фоновое обучение

В приложении «TClaude-Orch» есть окно «Фон» (⇧⌘B): работа, кейсы, плейбуки, журнал с откатом и настройки обучения; подробности — [app/README.md](app/README.md#окно-фон).

Этап 1: оркестратор сам, без команд пользователя, превращает сессии в **кейсы** — описания «что делали и чем кончилось». Этапы 2–3 (плейбуки, судья, вкладка «Фон» в приложении) впереди.

- **Что делает.** Раз в `tickMs` (30 с) собирает события сессий (лента оркестратора и транскрипты Claude Code, цепочка `/clear` — один кейс) и ставит задания фоновому агенту-сборщику: он дописывает `summary.md` (порциями, интервал `intervalMin`, закрытие по простою `idleMin` или при закрытии вкладки). Агенты-сборщики работают в служебной сессии `background` (скрыта из списков и шины; в CLI видна через `ls --all`), одновременно не больше `maxAgents`.
- **Файлы** (`~/.nessy-orch`): `learning.json` — настройки (правится руками, подхватывается на следующем тике без рестарта); `learning/jobs.json` — очередь заданий; `cases/<id>/` — `state.json`, `case.md`, `summary.md`, `notes.md`, `raw/events.jsonl`, `raw/transcript-<чат>.jsonl`. Промпт сборщика — `learning/prompts/session-collector.md`.
- **`learning.json`:** `enabled`, `autoReview`, `intervalMin` (1–120), `idleMin` (5–1440), `maxAgents` (1–6), `disabledSessions`. Нет файла — умолчания (`ORCH_LEARNING_DEFAULT=0` выключает обучение по умолчанию). Выключенное обучение не заводит кейсы; уже поставленные и ручные задания идут. Живой кейс заводится только для сессий, созданных после первого запуска обучения (точка отсчёта в `learning/meta.json`); старые берутся разбором прошлого. Кейс в `error` сам ничего не запускает (новые события в него собираются): `POST /learning/jobs/:id/retry`, `learn run` или пересборка кейса возвращают его в работу. Фоновые агенты после ответа удаляются, их ответы лежат в `cases/<id>/runs/<задание>-<k>.md` (не-кейсовые задания — `learning/runs/<объект>/`).
- **CLI:** `learn` (= `learn status`: настройки, очередь, кейсы), `learn on|off [--session S]`, `learn run [--session S]` (собрать итоговое описание сейчас), `case ls|show|rm|rebuild`. Сессию с незакрытым кейсом удалить нельзя, пока кейс не `ready`.
- **Разбор прошлых сессий.** `learn backfill` печатает кандидатов — сессии без кейса и транскрипты Claude Code (`~/.claude/projects`, `CLAUDE_PROJECTS_DIR`), где вызывался `nessy-orch spawn|send`; `learn backfill --all | <id…>` заводит кейсы `source: backfill` (для транскрипта `c-t-<чат>`) и сразу ставит итоговое задание. Повтор по тому же id ничего не дублирует: id попадает в `skipped`.
- **Плейбуки.** Из ≥ 3 готовых кейсов одной задачи сопоставитель находит группу, сборщик пишет плейбук (скилл на английском: `SKILL.md`, `stages/`, `rules.md`, `CHANGELOG.md`; история — git в `~/.nessy-orch/playbooks/<id>/`), авто-ревью в шесть ступеней отправляет его в пробный режим (`trial`), судья после каждого кейса ведёт счётчики правил. Активные плейбуки публикуются плагином `nessy-playbooks` (`ORCH_PLAYBOOKS_PLUGIN_DIR`, по умолчанию `~/.claude/skills/nessy-playbooks`). Каждое автоматическое решение пишется в журнал и откатывается одной командой: `learn journal --revert <id>`. Ручное управление: `playbook approve|reject|revert|rm`; заметки (`case note`, `playbook note`) автоматически не переписываются; правки текстом — чат кейса или плейбука (`POST /learning/chat/:subject`).
- **API:** `GET /learning` и т. д. — см. [docs/api.md](docs/api.md#фоновое-обучение); события `learning_*` идут в `GET /stream`.

## HTTP API

`127.0.0.1:4337`, JSON, без аутентификации (только loopback).

| Метод и путь | Назначение |
|---|---|
| `GET /health`, `GET /status`, `GET /graph` | Служебное: здоровье, состояние, пространства, агенты, роли и сессии |
| `GET /sessions?status=`, `POST /sessions {title,owner?,id?}` | Сессии оркестраторов; id по умолчанию — slug заголовка + 4 hex (`409 session_exists` при занятом) |
| `GET /sessions/:id`, `PATCH /sessions/:id {title?,status?,summary?}`, `DELETE /sessions/:id` | Сессия: правка/закрытие (`status: done`), удаление (`409 session_busy`, если агенты работают; агенты → `session: null`) |
| `POST /sessions {cwd, chatId, title?}` | Сессия вкладки проекта: заголовок по умолчанию — имя папки; чат Claude (`--session-id`) уже привязан к другой сессии — `409 chat_bound` |
| `POST /sessions/attach {chatId, cwd?, from?}` | Чат Claude начался или сменился (хук SessionStart): сессия этого чата (создаётся, если нет), у прежней `successor` указывает на неё |
| `POST /sessions/:id/closed` | Вкладка закрыта: работающие агенты остановлены, сессия остаётся |
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
| `GET /agents/:ref/wait?timeout=` | Дождаться, пока агент освободится, и получить его последний ответ (`WaitResponse {done, agent, reply?}`) |
| `GET /learning`, `PATCH /learning/settings`, `POST /learning/run`, `…/cases/:id`, `…/backfill` | Фоновое обучение: настройки, очередь, кейсы, разбор прошлых сессий ([docs/api.md](docs/api.md#фоновое-обучение)) |
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
| `MAX_SESSIONS` | `32` | `--max-sessions` демона пространства (живых сессий; закрытые по простою не считаются) |
| (авто) | `<home>/token` | Токен оператора (0600): приложение и терминал главного агента (`NESSY_ORCH_TOKEN`). Без него изменения API недоступны, агентам остаются команды от своего имени по ключу из вводной (`docs/api.md`, «Доступ») |
| `ORCH_MAX_DEPTH` | `2` | Глубина порождения: агент оператора — 0; агент, запущенный агентом, — 1 и т. д. Глубже — `429 depth_exceeded` |
| `ORCH_MAX_ACTIVE` | `12` | Сколько агентов сессии работают одновременно (`429 too_many_active`) |
| `ORCH_MAX_AGENTS` | `20` | Сколько агентов всего: простаивающих сверх лимита сервер удаляет сам (самых давних), `429 too_many_agents` — только когда все работают |
| `ORCH_MAX_SESSIONS` | `10` | Сколько сессий хранить: лишние давние (без работающих агентов, 30 мин без активности) удаляются при создании новой |
| `ORCH_AGENT_TTL_MIN` | `360` | Через сколько минут простоя завершённый (архивный) агент удаляется автоматически (`0` — не удалять) |
| `ORCH_IDLE_CLOSE_SEC` | `120` | Через сколько секунд простоя закрывать сессию nessy агента (контекст сохраняется, сообщение поднимает её; `0` — не закрывать) |
| `ORCH_AUTO_APPROVE` | `1` | Автоподтверждение прав агентов |
| `ORCH_TURN_RETRIES` | `2` | Сколько раз повторять поручение, если ход агента оборвался ошибкой nessy (`0` — не повторять) |
| `ORCH_MAX_HOPS` | `8` | Максимальная длина цепочки агент → агент |
| `ORCH_RATE_LIMIT` | `30` | Сообщений на пару в минуту |
| `ORCH_HEALTH_TIMEOUT_MS` | `60000` | Ожидание готовности `nessy serve` |
| `ORCH_WARM_SESSIONS` | `2` | Заранее созданных сессий nessy на пространство (быстрый запуск агентов; `0` — выключено) |
| `ORCH_LEARNING_DEFAULT` | `1` | Фоновое обучение включено, пока нет `learning.json` |
| `ORCH_PLAYBOOKS_PLUGIN_DIR` | `~/.claude/skills/nessy-playbooks` | Каталог плагина `nessy-playbooks` с активными плейбуками |
| `ORCH_LEARNING_TICK_MS` | `30000` | Как часто обучение собирает события сессий (`0` — без таймера) |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Где искать транскрипты Claude Code (разбор прошлых сессий) |
| `ORCH_SEED_ROLES` | `1` | Заливать готовые роли из `roles/` (все при первом запуске, потом только новые; роль-пакет — папка с `role.md`, см. [roles/README.md](roles/README.md)) |

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
    http/                HTTP-сервер: роутер, guard (Host/Origin), валидация тел, SSE, routes/*
    cli/                 CLI: аргументы, клиент API, форматирование, commands/*, launchd
app/                     нативное приложение macOS (SwiftPM): NessyKit (модель, API, SSE, состояние) и NessyOrch (SwiftUI)
test/
  unit/                  lib, domain, application, infrastructure, interfaces
  integration/           api, messaging, lifecycle, archive, roles, role-presets, plan, streams, persistence, sessions
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
