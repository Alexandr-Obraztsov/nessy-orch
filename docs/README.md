# nessy-orch — документация

Оркестратор для нативной нейросети nessy. Главная нода («you» — человек и Claude Code) запускает субагентов
nessy, агенты общаются между собой и с главной нодой, всё это видно в одном графе и в общей ленте.

| Документ | О чём |
|---|---|
| [requirements.md](requirements.md) | Что и зачем строим: цели, требования, принятые решения, не-цели |
| [architecture.md](architecture.md) | Ядро: модели, маршрутизация сообщений, защиты, хранение, процессы |
| [api.md](api.md) | HTTP/SSE API оркестратора (контракт для UI и CLI) |
| [cli.md](cli.md) | Команды `nessy-orch`, сценарии для главного агента, коды выхода |
| [ui.md](ui.md) | **Подробное описание UI**: граф, общий чат, чат агента, данные, критерии приёмки |
| [roadmap.md](roadmap.md) | Что сделано, что проверено, известные проблемы и план работ |
| [contract/README.md](contract/README.md) | Контракт `nessy serve` (ACP), подтверждённый живьём, + список правок клиента |

## Состояние на 2026-10-08 (кратко)

- Ядро, API, CLI, launchd-установщик, фейковый `nessy serve` и тесты **написаны**. Типизация сервера проходит (`tsc`).
- UI **не написан** — только спецификация ([ui.md](ui.md)). UI делается отдельно поверх готового API.
- Полный прогон тестов **не подтверждён**: в песочнице tclaude нельзя посылать сигналы дочерним процессам
  (`kill EPERM`), поэтому тесты зависают при остановке фейкового serve. Запускать `npm test` нужно **вне песочницы**.
  Подробности — в [roadmap.md](roadmap.md).
- Клиент `nessy serve` (`src/core/nessy-client.ts`) требует правок по [contract/README.md](contract/README.md) — их сделает
  агент с полным доступом к nessy.

## Быстрый старт (после правок и сборки, вне песочницы)

```sh
cd ~/Projects/nessy-orch
npm install && npm run build
node dist/src/main.js                    # или: node dist/src/cli/main.js install  (launchd)
bin/nessy-orch space add ~/Projects/shippy
bin/nessy-orch spawn --space shippy --name reviewer --wait "посмотри README и скажи, что это"
```
