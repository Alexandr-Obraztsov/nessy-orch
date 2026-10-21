# TClaude-Orch для macOS

Нативное приложение (SwiftUI, macOS 26) для оркестратора nessy-orch: сессии Claude, агенты (окно агента с чатом, планом, источниками и счётчиками), роли.

## Готовый билд

`release/TClaude-Orch-macOS.zip` — приложение `TClaude-Orch.app` (arm64, подпись ad-hoc). Распаковать, затем один раз снять карантин
и открыть:

```sh
xattr -cr "TClaude-Orch.app" && open "TClaude-Orch.app"
```

Нужен запущенный оркестратор (`bin/nessy-orch install` или `node dist/src/main.js`); адрес по умолчанию `http://127.0.0.1:4337`
(`defaults write com.nessy.orch.app serverURL "http://127.0.0.1:4338"` — другой).

## Сборка из исходников

```sh
swift test                   # тесты NessyKit
scripts/build-app.sh --run   # release-сборка build/TClaude-Orch.app и запуск
```

Дизайн: [../docs/design/](../docs/design/). Ссылки: `nessy-orch://session/<id>`, `nessy-orch://agent/<id>`.

## Как открыть терминал в папке

```sh
nessy-orch .                     # новое окно в текущей папке (CLI делает open "nessy-orch://terminal?dir=…")
open -a "TClaude-Orch" .           # то же через Finder-обработчик папок; можно перетащить папку на значок в Dock
open "nessy-orch://terminal?dir=%2FUsers%2Fme%2Fproj"
```

Запуск без папки (Dock, Spotlight) открывает окно в домашнем каталоге. ⌘N — новое окно в той же папке, ⇧⌘O — выбрать папку.

## Раскладка окна (docs/design/layout-v2.md)

- Одно окно — один терминал (оболочка `$SHELL`, login) в папке и одна сессия оркестратора (`NESSY_ORCH_SESSION`, `NESSY_ORCH_DIR`).
  Пустая сессия удаляется при закрытии окна. Окна — `WindowGroup(id: "terminal", for: TerminalWindowValue)`, невидимое окно `launcher`
  открывает домашнее окно, если не пришла ссылка или папка.
- Окно одно: сверху шапка (светофор, переключатель проектов, кнопка панели и настройки), слева терминал активного проекта, справа панель агентов его
  сессии (список ⇄ карточка). Проектов в окне несколько, у каждого свой терминал и своя сессия оркестратора.
- Хуки Claude и CLI `nessy-orch` приходят с плагином nessy: при запуске приложение копирует его в `~/.claude/skills/nessy` (Claude Code подхватывает такую папку
  как плагин `nessy@skills-dir` в любом запуске `claude`, в том числе после закрытия и повторного открытия) и обновляет копию при смене версии.
  Никаких обёрток оболочки, флагов `--settings`/`--plugin-dir` и файлов в `~/.nessy-orch` не нужно. Терминал даёт хукам только ключ `NESSY_ORCH_TERMINAL`.
- Терминал: SwiftTerm 1.20 (MIT, единственная внешняя зависимость), SF Mono 13, ANSI-палитра по теме. ⌘N, ⇧⌘O, ⌘W, ⌘⌥B (сочетания настраиваются); остальные клавиши
  (Esc, стрелки, Ctrl) достаются терминалу, пока фокус в нём. Выход с живыми терминалами — с подтверждением.
- Кнопки: круглые Liquid Glass, 36 pt, иконка без текста; не больше трёх в полосе (карта — в layout-v2.md).
- Отладочные флаги для снимков: `-debug.appearance light|dark`, `-debug.terminalDir <папка>`, `-debug.openSession <id>`,
  `-debug.terminalCommand "<команда>"` (выполнить и остаться в оболочке, например `type claude; claude --version`),
  `-debug.panel hidden`, `-debug.openAgent <id>`, `-debug.fullscreen YES|NO`, `-debug.goalOpen/planOpen/focusComposer/rolesPopover`, `-debug.menuPreview YES`,
  `-debug.openBackground work|cases|playbooks|journal|settings` (окно «Фон»).
- Окно «Фон» (обучение): кнопка в шапке, меню «Сессия → Фон…» (⇧⌘B), ссылка `nessy-orch://background/<раздел>[/<id>]`.
- Запросов прав в интерфейсе нет (автоподтверждение), копирования из чата тоже нет — текст выделяется вручную.
