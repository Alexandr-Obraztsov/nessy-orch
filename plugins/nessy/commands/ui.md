---
description: Ссылка на панель nessy-orch и состояние оркестратора
allowed-tools: Bash(nessy-orch status), Bash(nessy-orch status *)
---

Напиши пользователю ссылку на панель nessy-orch: <http://127.0.0.1:4337> — там видно агентов, их планы и
переписку.

Затем выполни `nessy-orch status` (если команды нет в PATH — `~/Projects/nessy-orch/bin/nessy-orch status`) и
коротко, в 1–3 строки, перескажи результат: жив ли оркестратор и что он сообщает о себе.

Если команда падает с «оркестратор недоступен», сам его не запускай: ты можешь быть в песочнице, и сервер
с агентами оказались бы в ней же. Попроси пользователя выполнить в обычном терминале `bin/nessy-orch install`
(сервис launchd) или `node ~/Projects/nessy-orch/dist/src/main.js`.
