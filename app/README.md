# Nessy Orch для macOS

Нативное приложение (SwiftUI, macOS 26) для оркестратора nessy-orch: сессии Claude, агенты (окно агента с чатом, планом, источниками и счётчиками), роли.

## Готовый билд

`release/Nessy-Orch-macOS.zip` — приложение `Nessy Orch.app` (arm64, подпись ad-hoc). Распаковать, затем один раз снять карантин
и открыть:

```sh
xattr -cr "Nessy Orch.app" && open "Nessy Orch.app"
```

Нужен запущенный оркестратор (`bin/nessy-orch install` или `node dist/src/main.js`); адрес по умолчанию `http://127.0.0.1:4337`
(`defaults write com.nessy.orch.app serverURL "http://127.0.0.1:4338"` — другой).

## Сборка из исходников

```sh
swift test                   # тесты NessyKit
scripts/build-app.sh --run   # release-сборка build/Nessy Orch.app и запуск
```

Дизайн: [../docs/design/](../docs/design/). Ссылки: `nessy-orch://session/<id>`, `nessy-orch://agent/<id>`.

## Как открыть терминал в папке

```sh
nessy-orch .                     # новое окно в текущей папке (CLI делает open "nessy-orch://terminal?dir=…")
open -a "Nessy Orch" .           # то же через Finder-обработчик папок; можно перетащить папку на значок в Dock
open "nessy-orch://terminal?dir=%2FUsers%2Fme%2Fproj"
```

Запуск без папки (Dock, Spotlight) открывает окно в домашнем каталоге. ⌘N — новое окно в той же папке, ⇧⌘O — выбрать папку.

## Раскладка окна (docs/design/layout-v2.md)

- Одно окно — один терминал (оболочка `$SHELL`, login) в папке и одна сессия оркестратора (`NESSY_ORCH_SESSION`, `NESSY_ORCH_DIR`).
  Пустая сессия удаляется при закрытии окна. Окна — `WindowGroup(id: "terminal", for: TerminalWindowValue)`, невидимое окно `launcher`
  открывает домашнее окно, если не пришла ссылка или папка.
- Слева системный парящий сайдбар (`NavigationSplitView`): агенты сессии, список ⇄ карточка; внизу связь, точка состояния Claude и круглые кнопки
  «Роли» и «⋯». Справа — терминал (SwiftTerm) на всю высоту. Шапки нет: светофор и системная кнопка панели; панель свёрнута — у терминала
  отступ сверху под шапку (анимируется).
- Хуки Claude подключаются прозрачно: оболочка стартует с функцией `claude`, добавляющей `--settings ~/.nessy-orch/claude-hooks.json`
  (zsh — через `~/.nessy-orch/zdotdir`, bash — `--rcfile`, остальные — PATH-обёртка; файлы пользователя не меняются).
  Скрипты и файл хуков пишет приложение перед стартом оболочки (`ShellIntegration`, `ClaudeHooks`).
- Терминал: SwiftTerm 1.20 (MIT, единственная внешняя зависимость), SF Mono 13, ANSI-палитра по теме. ⌘N, ⇧⌘O, ⌘W, ⌘⌥B; остальные клавиши
  (Esc, стрелки, Ctrl) достаются терминалу, пока фокус в нём. Выход с живыми терминалами — с подтверждением.
- Кнопки: круглые Liquid Glass, 36 pt, иконка без текста; не больше трёх в полосе (карта — в layout-v2.md).
- Отладочные флаги для снимков: `-debug.appearance light|dark`, `-debug.terminalDir <папка>`, `-debug.openSession <id>`,
  `-debug.terminalCommand "<команда>"` (выполнить и остаться в оболочке, например `type claude; claude --version`),
  `-debug.panel hidden`, `-debug.openAgent <id>`, `-debug.fullscreen YES|NO`, `-debug.goalOpen/planOpen/focusComposer/rolesPopover`, `-debug.menuPreview YES`.
- Запросов прав в интерфейсе нет (автоподтверждение), копирования из чата тоже нет — текст выделяется вручную.
