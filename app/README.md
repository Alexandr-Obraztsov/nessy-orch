# Nessy Orch для macOS

Нативное приложение (SwiftUI, macOS 26) для оркестратора nessy-orch: сессии Claude, агенты, источники, статистика, роли.

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
