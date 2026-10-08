# nessy-orch — документация

Оркестратор для нативной нейросети nessy. Главная нода («you» — человек и Claude Code) запускает субагентов
nessy, агенты общаются между собой и с главной нодой, всё это видно в одном графе и в общей ленте.

| Документ | О чём |
|---|---|
| [requirements.md](requirements.md) | Что и зачем строим: цели, требования, принятые решения, не-цели |
| [architecture.md](architecture.md) | Ядро: модели, маршрутизация сообщений, защиты, хранение, процессы |
| [api.md](api.md) | HTTP/SSE API оркестратора (контракт для UI и CLI) |
| [../README.md](../README.md) | Обзор проекта, CLI, «Веб-интерфейс» (граф, лента, чат агента), разработка |
| [contract/README.md](contract/README.md) | Контракт `nessy serve` (ACP), подтверждённый живьём, + статус правок клиента |

## Состояние на 2026-10-08 (кратко)

- Ядро перестроено по слоям (domain, application, infrastructure, interfaces) — см. [architecture.md](architecture.md).
- Клиент `nessy serve` исправлен по [contract/README.md](contract/README.md) (`src/infrastructure/nessy/`).
- UI написан: React + Vite, `ui/` (описание — в [README.md](../README.md), «Веб-интерфейс»).
- Серверные тесты: 105 проходят (`npm test`). E2E-набор Playwright лежит в `e2e/` (`npm run test:e2e`).

## Быстрый старт (вне песочницы)

```sh
cd ~/Projects/nessy-orch
npm install && npm run build
node dist/src/main.js                    # или: node dist/src/interfaces/cli/main.js install  (launchd)
bin/nessy-orch space add ~/Projects/shippy
bin/nessy-orch spawn --space shippy --name reviewer --wait "посмотри README и скажи, что это"
```
