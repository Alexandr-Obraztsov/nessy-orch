# Интеграция с nessy-acp-agent

## Обзор

nessy-acp-agent — посредник между IDE-плагином и удалённым AI-агентом. Общение с IDE идёт по протоколу ACP (JSON-RPC ndjson через stdio), с удалённым агентом — по протоколу A2A (SSE streaming).

```
IDE плагин  ──stdio──>  nessy-acp-agent  ──A2A SSE──>  удалённый агент
 (ACP Client)           (ACP Agent)                    (A2A Server)
                              │
                              ├──MCP stdio──>  MCP-сервер (локальный)
                              └──MCP HTTP──>   MCP-сервер (удалённый)
```

Агент берёт на себя:

- Управление сессиями
- Запросы разрешений на выполнение инструментов
- Выполнение инструментов (через ACP, MCP или локально)
- Проброс сообщений между IDE и A2A-агентом

---

## 1. Контракт со стороны IDE (ACP-клиент)

### 1.1. Запуск процесса

IDE запускает агент как дочерний процесс:

```
node /path/to/nessy-acp-agent/dist/index.js
```

Общение — через stdin/stdout (ndjson). Логи пишутся в stderr.

#### Переменные окружения

| Переменная                          | Обязательная | Описание                                                           |
| ----------------------------------- | ------------ | ------------------------------------------------------------------ |
| `AGENT_CARD_URL`                    | нет\*        | URL agent card удалённого A2A-агента                               |
| `AGENT_TOKEN`                       | нет\*        | Токен для авторизации на удалённом агенте                          |
| `TOKEN_PATH`                        | нет\*        | Путь к JSON-файлу с токеном `{ "value": "..." }`                   |
| `USER_AGENT`                        | нет          | Product token ACP-клиента                                          |
| `SESSION_PERMISSION_RESOLVE_METHOD` | нет          | `extended` включает расширенный режим для новых сессий             |
| `LOG_FILE`                          | нет          | Путь к файлу логов                                                 |
| `DP_VERSION`                        | нет          | Версия `dp` только для первичной загрузки (по умолчанию `13.14.1`) |
| `DISABLE_MARKETPLACE`               | нет          | `true` отключает marketplace и установку и обновление `nessy-cli`  |
| `NESSY_ACP_HOME_DIR`                | нет          | Имя каталога хранилищ ACP; по умолчанию `.nestor`                  |
| `NESSY_ACP_SESSIONS_PATH`           | нет          | Явный корень sessions вместо пути из `NESSY_ACP_HOME_DIR`          |

\*Без `AGENT_CARD_URL` агент работает в режиме эхо (без проброса к A2A).

При `DISABLE_MARKETPLACE=true` агент не создаёт marketplace client/hub, не загружает и не обновляет
`nessy-cli`, а методы `nestor/marketplace/*` отвечают ошибкой недоступности. Локальные skills и
`nestor/skills/list` продолжают работать.

`NESSY_ACP_HOME_DIR` должен содержать одно имя каталога. Пустые значения, абсолютные пути,
разделители `/` и `\`, `.` и `..` завершают запуск типизированной ошибкой до создания файлов.
Значение читается один раз при старте: global root — `<home>/<homeDir>`, а workspace root для
каждой сессии — `<cwd>/<homeDir>`. MCP, sessions, основной home-источник skills и управляемая
установка `nessy-cli` используют только выбранный корень, без чтения, записи или миграции данных
из второго каталога.

Для session-хранилищ действует приоритет: внутренний `rootOverride` → `NESSY_ACP_SESSIONS_PATH` →
корень sessions из выбранного `homeDir`. Значение `NESSY_ACP_SESSIONS_PATH` трактуется как готовый
путь, не дополняется `homeDir` и фиксируется при старте процесса.

На старте агент держит бинарник `dp` в фиксированной папке `~/.nessy/dp_latest/` (та же, что у
nessy-cli): если его нет — скачивает (версию задаёт опциональный `DP_VERSION`, иначе значение по
умолчанию), а затем поддерживает актуальность через `~/.nessy/dp_latest/dp update` (не чаще раза
в 24 часа). `DP_VERSION` влияет только на первую загрузку. Сбой провижинга логируется и не
прерывает запуск.

Приоритет токена: `TOKEN_PATH` > `AGENT_TOKEN`.

Режим разрешений обычно согласуется через
`clientCapabilities._meta.permissionResolveMethod` в ACP `initialize`. Если клиент не умеет
передавать это поле, запуск с `SESSION_PERMISSION_RESOLVE_METHOD=extended` включает тот же режим
для новых сессий. При загрузке режим не меняется: он восстанавливается из `session_created`.

Нативный JetBrains ACP UI запускает агент с `USER_AGENT=jetbrains-acp-ui` и
`SESSION_PERMISSION_RESOLVE_METHOD=extended`. Compatibility profile передаёт `search_files` и
`list_files` как generic ACP tool calls (`kind: other`, без `locations`), не меняя канонический
presentation в истории сессии.

Альтернативно URL можно передать через CLI-аргумент:

```
node dist/index.js --agent-card-url https://example.com/.well-known/agent.json
```

#### Пример запуска (VSCode)

```json
{
    "command": "node",
    "args": ["/path/to/nessy-acp-agent/dist/index.js"],
    "env": {
        "AGENT_CARD_URL": "https://example.com/.well-known/agent.json",
        "TOKEN_PATH": "/path/to/token.json"
    }
}
```

### 1.2. Инициализация (initialize)

Первый вызов после запуска. Клиент сообщает свои capabilities, агент — свои.

**Запрос:**

```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": 1,
        "clientCapabilities": {
            "fs": {
                "readTextFile": true,
                "writeTextFile": true
            },
            "terminal": false,
            "_meta": {
                "tools": {
                    "list_files": true
                }
            }
        }
    }
}
```

**Ответ:**

```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
        "protocolVersion": 1,
        "agentCapabilities": {
            "loadSession": false
        }
    }
}
```

#### Capabilities клиента

| Поле                | Тип     | Описание                                                   |
| ------------------- | ------- | ---------------------------------------------------------- |
| `fs.readTextFile`   | boolean | Клиент может читать файлы (ACP basic: `readTextFile`)      |
| `fs.writeTextFile`  | boolean | Клиент может записывать файлы (ACP basic: `writeTextFile`) |
| `terminal`          | boolean | Клиент поддерживает терминал (зарезервировано)             |
| `_meta.tools.<имя>` | boolean | Клиент реализует extension method для инструмента          |

Capabilities влияют на выбор реализации инструментов — подробнее в разделе [Инструменты](#2-инструменты-tools).

### 1.3. Создание сессии (session/new)

**Запрос:**

```json
{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "session/new",
    "params": {
        "cwd": "/home/user/project",
        "mcpServers": []
    }
}
```

**Ответ:**

```json
{
    "jsonrpc": "2.0",
    "id": 2,
    "result": {
        "sessionId": "a1b2c3d4e5f6..."
    }
}
```

`cwd` — рабочая директория сессии. Относительные пути в вызовах инструментов разрешаются относительно этого пути.

`mcpServers` — массив MCP-серверов для подключения (см. [MCP-серверы](#24-mcp-реализация)).

### 1.4. Отправка запроса (session/prompt)

**Запрос:**

```json
{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "session/prompt",
    "params": {
        "sessionId": "a1b2c3d4e5f6...",
        "prompt": [{ "type": "text", "text": "Покажи файлы в текущей директории" }]
    }
}
```

**Потоковый ответ (session/update):**

```json
{
    "jsonrpc": "2.0",
    "method": "session/update",
    "params": {
        "sessionId": "a1b2c3d4e5f6...",
        "update": {
            "sessionUpdate": "agent_message_chunk",
            "content": { "type": "text", "text": "Вот список файлов:\n" }
        }
    }
}
```

**Финальный ответ:**

```json
{
    "jsonrpc": "2.0",
    "id": 3,
    "result": {
        "stopReason": "end_turn"
    }
}
```

`stopReason`: `"end_turn"` — нормальное завершение, `"cancelled"` — отмена по `cancel`.

### 1.5. Отмена запроса (cancel)

**Уведомление (без id):**

```json
{
    "jsonrpc": "2.0",
    "method": "cancel",
    "params": {
        "sessionId": "a1b2c3d4e5f6..."
    }
}
```

### 1.6. Запрос разрешения (session/request_permission)

Во время выполнения prompt агент может запросить у клиента разрешение на выполнение инструмента.

**Запрос от агента:**

```json
{
    "jsonrpc": "2.0",
    "id": 0,
    "method": "session/request_permission",
    "params": {
        "sessionId": "a1b2c3d4e5f6...",
        "toolCall": {
            "toolCallId": "call_abc123",
            "title": "list_files"
        },
        "options": [
            {
                "optionId": "allow_once",
                "name": "Allow once",
                "kind": "allow_once"
            },
            {
                "optionId": "allow_always",
                "name": "Allow always",
                "kind": "allow_always"
            },
            {
                "optionId": "reject_once",
                "name": "Reject once",
                "kind": "reject_once"
            },
            {
                "optionId": "reject_always",
                "name": "Reject always",
                "kind": "reject_always"
            }
        ]
    }
}
```

**Ответ клиента:**

```json
{
    "jsonrpc": "2.0",
    "id": 0,
    "result": {
        "outcome": {
            "outcome": "selected",
            "optionId": "allow_always"
        }
    }
}
```

Варианты `optionId`:

- `allow_once` — разрешить один раз
- `allow_always` — разрешить всегда (кэшируется на сессию для данного инструмента)
- `reject_once` — отклонить один раз
- `reject_always` — отклонить всегда (кэшируется)

Для отмены запроса:

```json
{
    "jsonrpc": "2.0",
    "id": 0,
    "result": {
        "outcome": { "outcome": "cancelled" }
    }
}
```

---

### 1.7. Управление разрешениями (nestor/permission/\*)

Агент поддерживает ACP extension методы для управления разрешениями через storage.

#### `nestor/permission/list` — получить правила

**Запрос:**

```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "nestor/permission/list",
    "params": {
        "sessionId": "a1b2c3d4...",
        "scope": "project" // опционально: "project" | "user"
    }
}
```

**Ответ:**

```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
        "rules": {
            "project": {
                "allow": ["read_file(README.md)"],
                "deny": ["write_to_file(.env*)"],
                "ask": []
            },
            "user": {
                "allow": ["dp_sage:*"],
                "deny": [],
                "ask": []
            }
        }
    }
}
```

#### `nestor/permission/update` — обновить правила (wholesale replace)

**Запрос:**

```json
{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "nestor/permission/update",
    "params": {
        "sessionId": "a1b2c3d4...",
        "rules": {
            "project": {
                "allow": ["read_file(*)"],
                "deny": ["write_to_file(.env*)"],
                "ask": []
            }
        }
    }
}
```

**Ответ:**

```json
{
    "jsonrpc": "2.0",
    "id": 2,
    "result": {
        "applied": ["project"],
        "rules": {
            "project": {
                "allow": ["read_file(*)"],
                "deny": ["write_to_file(.env*)"],
                "ask": []
            }
        }
    }
}
```

**Валидация:** все-or-nothing. Если хотя бы одно правило невалидно (неверный формат ключа, missing section), возвращается JSON-RPC error и ничего не записывается.

---

## 2. Инструменты (Tools)

Агент поддерживает инструменты для работы с файловой системой. Каждый инструмент имеет несколько реализаций, упорядоченных по приоритету. При вызове выбирается первая доступная.

| Инструмент      | Реализации (по приоритету)    |
| --------------- | ----------------------------- |
| `read_file`     | ACP basic → local             |
| `write_to_file` | ACP basic → local             |
| `list_files`    | MCP → ACP advertising → local |

### 2.1. ACP basic реализация

Агент вызывает стандартные ACP-методы на клиенте: `readTextFile`, `writeTextFile`.

**Доступна, если:** клиент объявил `fs.readTextFile: true` / `fs.writeTextFile: true` в `initialize`.

Пример: агент хочет прочитать файл — вызывает `readTextFile` на IDE-клиенте через ACP-соединение. IDE читает файл из workspace и возвращает содержимое.

### 2.2. ACP advertising реализация

Механизм для инструментов, не входящих в стандартные ACP capabilities. Клиент объявляет поддержку инструмента при инициализации, агент вызывает extension method.

**Доступна, если:** клиент объявил `clientCapabilities._meta.tools.<имя_инструмента>: true`.

#### Объявление capability (клиент → агент)

В `initialize`:

```json
{
    "clientCapabilities": {
        "_meta": {
            "tools": {
                "list_files": true
            }
        }
    }
}
```

#### Extension method (агент → клиент)

При вызове инструмента агент отправит JSON-RPC запрос клиенту:

```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "_tools/list_files",
    "params": {
        "sessionId": "a1b2c3d4e5f6...",
        "path": "/home/user/project/src"
    }
}
```

Клиент должен выполнить операцию и вернуть результат:

```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
        "result": "index.ts\nutils/\ntypes.ts\npackage.json"
    }
}
```

Формат `result.result` — строка. Для `list_files` — список файлов через `\n`, директории с `/` на конце.

### 2.3. Локальная реализация (fallback)

Если ни ACP, ни MCP реализация недоступна, инструмент выполняется локально через Node.js API:

- `read_file` → `fs.readFile()`
- `write_to_file` → `fs.writeFile()` (с созданием директорий)
- `list_files` → `fs.readdir()` (с маркером `/` для директорий)

Локальная реализация доступна всегда.

### 2.4. MCP реализация

MCP-серверы подключаются при создании сессии. Агент обнаруживает доступные инструменты через `listTools()` и привязывает конкретный MCP-клиент к реализации.

**Доступна, если:** хотя бы один MCP-сервер предоставляет нужный инструмент (например, `list_files`).

#### Stdio MCP-сервер

```json
{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "session/new",
    "params": {
        "cwd": "/home/user/project",
        "mcpServers": [
            {
                "name": "filesystem",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/project"],
                "env": []
            }
        ]
    }
}
```

Агент запустит указанную команду как дочерний процесс и подключится по stdio.

С переменными окружения:

```json
{
    "name": "custom-server",
    "command": "/usr/local/bin/mcp-server",
    "args": ["--verbose"],
    "env": [
        { "name": "API_KEY", "value": "secret" },
        { "name": "DEBUG", "value": "true" }
    ]
}
```

#### HTTP MCP-сервер

```json
{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "session/new",
    "params": {
        "cwd": "/home/user/project",
        "mcpServers": [
            {
                "name": "remote-tools",
                "type": "http",
                "url": "https://mcp.example.com/api",
                "headers": [{ "name": "Authorization", "value": "Bearer token123" }]
            }
        ]
    }
}
```

Headers передаются во все HTTP-запросы к MCP-серверу (подключение, вызов инструментов).

---

## 3. Контракт со стороны A2A (удалённый агент)

### 3.1. Подключение

Агент подключается к A2A-серверу по URL из `AGENT_CARD_URL`. Токен из `TOKEN_PATH` / `AGENT_TOKEN` передаётся в заголовке `Nestor-Token`.

Версия адаптера выбирается по major протокола из agent card:
`protocolVersion` в старой схеме или `supportedInterfaces[].protocolVersion`
в новой. Major `0` выбирает `a2a/v1`, major `1` — `a2a/v2`; minor и patch
на выбор не влияют. Старая карточка без версии считается A2A 0.3; если карточка
объявляет оба major для поддерживаемых транспортов, выбирается `a2a/v2`.
Другие major отклоняются. Адаптеры используют wire-форматы A2A 0.3 и 1.0 соответственно.
Переданный URL не переписывается: `/api/v1/` и `/api/v2/` в пути не заменяют
объявление протокола в карточке. Примеры wire-сообщений ниже приведены для A2A 0.3;
SDK преобразует сообщения A2A 1.0 в тот же доменный контракт.

### 3.2. Отправка сообщений

Агент отправляет сообщения через `sendMessageStream` (SSE streaming):

```typescript
{
  kind: "message",
  messageId: "<uuid>",
  role: "user",
  parts: [{ kind: "text", text: "текст от пользователя" }],
  contextId: "<id контекста, если есть>"
}
```

`contextId` передаётся начиная со второго сообщения в сессии (получен из первого ответа A2A).

### 3.3. Получение событий

Агент обрабатывает SSE-события от A2A:

| Событие           | Действие                                                               |
| ----------------- | ---------------------------------------------------------------------- |
| `message`         | Текстовые parts → потоком в IDE. DataParts → проверка на function call |
| `status-update`   | Обновление состояния задачи + parts из `status.message`                |
| `artifact-update` | Parts артефакта → потоком в IDE                                        |
| `task`            | Обновление contextId/taskId/status                                     |

### 3.4. Function calls через A2A (DataPart)

Удалённый агент может запросить выполнение инструмента через `DataPart` в сообщении. Агент обнаруживает function call по структуре данных.

#### Формат DataPart с function call

```json
{
    "kind": "data",
    "data": {
        "id": "call_abc123",
        "index": 0,
        "function": {
            "name": "list_files",
            "arguments": "{\"path\": \"src/\"}"
        }
    }
}
```

#### Обязательные поля

| Поле                 | Тип    | Описание                         |
| -------------------- | ------ | -------------------------------- |
| `id`                 | string | Уникальный ID вызова             |
| `index`              | number | Порядковый номер вызова          |
| `function.name`      | string | Имя инструмента (из списка ниже) |
| `function.arguments` | string | JSON-строка с аргументами        |

#### Поддерживаемые инструменты

| Имя               | Аргументы                                 |
| ----------------- | ----------------------------------------- |
| `read_file`       | `{ "path": "src/index.ts" }`              |
| `write_to_file`   | `{ "path": "out.txt", "content": "..." }` |
| `list_files`      | `{ "path": "src/" }`                      |
| `replace_in_file` | зарезервировано                           |
| `search_files`    | зарезервировано                           |
| `execute_command` | зарезервировано                           |

#### Валидация

Агент считает DataPart function call-ом, если:

1. `data.id` — строка
2. `data.index` — число
3. `data.function` — объект
4. `data.function.name` — строка из списка известных инструментов
5. `data.function.arguments` — строка (JSON)

Если DataPart не проходит валидацию, он отправляется в IDE как текстовое сообщение (JSON).

#### Поток выполнения

```
A2A-агент                    nessy-acp-agent                    IDE
    │                              │                              │
    │  DataPart (function call)    │                              │
    │─────────────────────────────>│                              │
    │                              │  request_permission          │
    │                              │─────────────────────────────>│
    │                              │                              │
    │                              │  allow_always                │
    │                              │<─────────────────────────────│
    │                              │                              │
    │                              │  [выполнение инструмента]    │
    │                              │  (MCP / ACP adv. / local)    │
    │                              │                              │
    │                              │  extension method            │
    │                              │  (_tools/list_files)         │
    │                              │─────────────────────────────>│
    │                              │                              │
    │                              │  результат                   │
    │                              │<─────────────────────────────│
    │                              │                              │
```

---

## 4. Полная последовательность взаимодействия

```
IDE                          nessy-acp-agent                A2A-агент
 │                                 │                            │
 │  spawn process                  │                            │
 │────────────────────────────────>│                            │
 │                                 │                            │
 │  initialize (capabilities)      │                            │
 │────────────────────────────────>│                            │
 │  protocolVersion, agentCaps     │                            │
 │<────────────────────────────────│                            │
 │                                 │                            │
 │  session/new (cwd, mcpServers)  │                            │
 │────────────────────────────────>│  connect A2A               │
 │                                 │───────────────────────────>│
 │                                 │  connect MCP servers       │
 │  sessionId                      │                            │
 │<────────────────────────────────│                            │
 │                                 │                            │
 │  session/prompt                 │                            │
 │────────────────────────────────>│  sendMessageStream         │
 │                                 │───────────────────────────>│
 │                                 │                            │
 │                                 │  SSE: text parts           │
 │  session/update (chunks)        │<───────────────────────────│
 │<────────────────────────────────│                            │
 │                                 │                            │
 │                                 │  SSE: DataPart (tool call) │
 │                                 │<───────────────────────────│
 │                                 │                            │
 │  request_permission             │                            │
 │<────────────────────────────────│                            │
 │  allow_always                   │                            │
 │────────────────────────────────>│                            │
 │                                 │                            │
 │  _tools/list_files (ext method) │                            │
 │<────────────────────────────────│                            │
 │  result                         │                            │
 │────────────────────────────────>│                            │
 │                                 │                            │
 │                                 │  SSE: more text            │
 │  session/update (chunks)        │<───────────────────────────│
 │<────────────────────────────────│                            │
 │                                 │                            │
 │                                 │  SSE: status completed     │
 │  stopReason: "end_turn"         │<───────────────────────────│
 │<────────────────────────────────│                            │
```
