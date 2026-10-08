# MCP (Model Context Protocol) — интеграция

## Обзор

MCP-серверы предоставляют инструменты (tools), которые агент может использовать в процессе работы. Серверы подключаются при старте приложения (конфигурация по умолчанию из `package.json`) и могут дополняться при создании/загрузке сессии.

## Архитектура

```
Client (IDE) ──extMethod──> "nestor/mcp/preset" ──> McpHub.setupDefaults()
                                                          │
                                                     package.json
                                                     mcp.default
                                                          │
                                                          ▼
Client (IDE) ──newSession/loadSession──> McpConfigLoader.load(cwd)
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                         package.json  <home>/<homeDir>/ <cwd>/<homeDir>/
                         defaults         mcp.json         mcp.json
                              │               │               │
                              └───────┬───────┘───────────────┘
                                      ▼
                              mergeConfigs() ──> McpHub.applyConfigs()
                                                       │
Client (IDE) ──mcpServers──────────────────> McpHub.update() (inline)
                                                       │
                                                       ▼
                                              connectMcpServers()
                                                       │
                                        ┌──────────────┼──────────────┐
                                        ▼              ▼              ▼
                                   StdioTransport  HttpTransport   (skip)
                                        │              │
                                        └──────┬───────┘
                                               ▼
                                          IMcpClient
                                        (tools discovered)

McpConfigWatcher ──fs.watch──> <home>/<homeDir>/ + <cwd>/<homeDir>/
                                    │
                              (on file change)
                                    │
                                    ▼
                           McpConfigLoader.load() ──> McpHub.applyConfigs()
```

## Конфигурационные файлы

MCP-серверы конфигурируются на трёх уровнях. При загрузке они мержатся в порядке приоритета (от низшего к высшему):

1. **Дефолты из `package.json`** — `mcp.default` секция (загружаются через `nestor/mcp/preset`)
2. **Глобальный конфиг** — `<home>/<homeDir>/mcp.json`
3. **Конфиг проекта (workspace)** — `<cwd>/<homeDir>/mcp.json`
4. **Inline-серверы** — массив `mcpServers` из параметров `newSession` / `loadSession`

### Формат конфигурационного файла

Глобальный и workspace конфиги имеют одинаковый формат:

```json
{
    "env": {
        "DP_TOKEN": "your-token"
    },
    "mcpServers": {
        "dpSage": {
            "command": "~/.nessy/dp_latest/dp",
            "args": ["ai", "mcp", "sage"],
            "env": { "DP_WORKDIR": "$HOME/.nessy/dp_latest" },
            "autoApprove": ["dp_sage_completion"]
        },
        "whiteboard": {
            "type": "streamableHttp",
            "url": "https://whiteboard.t-tech.team/mcp",
            "headers": { "X-DP-TOKEN": "$DP_TOKEN" },
            "initialState": "disabled"
        }
    }
}
```

| Поле                        | Тип                                                                  | Описание                                                                   |
| --------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `env`                       | `Record<string, string>`                                             | Переменные окружения, инжектируются в stdio-серверы                        |
| `mcpServers`                | `Record<string, ServerConf>`                                         | Карта серверов (ключ — имя сервера)                                        |
| `mcpServers.*.command`      | `string`                                                             | Путь к исполняемому файлу (stdio-серверы)                                  |
| `mcpServers.*.args`         | `string[]`                                                           | Аргументы командной строки                                                 |
| `mcpServers.*.env`          | `Record<string, string>`                                             | Переменные окружения сервера (перекрывают глобальные `env`)                |
| `mcpServers.*.type`         | `string`                                                             | Тип транспорта: `"streamableHttp"` / `"http"`, `"sse"`; stdio по умолчанию |
| `mcpServers.*.url`          | `string`                                                             | URL эндпоинта (для HTTP-серверов)                                          |
| `mcpServers.*.headers`      | `Record<string, string>`                                             | HTTP-заголовки                                                             |
| `mcpServers.*.autoApprove`  | `string[]`                                                           | Инструменты, не требующие подтверждения                                    |
| `mcpServers.*.enabled`      | `boolean`                                                            | Явное состояние сервера, приоритетнее `initialState` в том же файле        |
| `mcpServers.*.initialState` | `"enabled" \| "disabled" \| Record<string, "enabled" \| "disabled">` | Начальное состояние сервера или отдельных методов                          |
| `mcpServers.*.timeout`      | `number`                                                             | Таймаут подключения (мс)                                                   |

### Правила мержа

- **`mcpServers`**: workspace-ключи перекрывают глобальные (shallow merge по имени сервера)
- **Состояние сервера**: строковый workspace `initialState` (`"enabled"` / `"disabled"`) перекрывает глобальное состояние, если workspace не задаёт собственный `enabled`. Карта состояний методов не меняет унаследованное состояние сервера.
- **Состояние методов**: карта `initialState` задаёт начальные ограничения. Выбор через `nestor/mcp/update` сохраняется для текущего cwd в `mcp-disabled.json` и заменяет эти ограничения. Пустой список в хранилище означает явное включение всех методов, а не возврат к начальным ограничениям.
- **`env`**: мержится по ключам (workspace перекрывает глобальные значения)
- **`env` + stdio-серверы**: глобальные `env` инжектируются в каждый stdio-сервер; собственный `env` сервера имеет приоритет

### Расположение файлов

| Файл              | Путь                        | Описание                          |
| ----------------- | --------------------------- | --------------------------------- |
| Глобальный конфиг | `<home>/<homeDir>/mcp.json` | Общие настройки для всех проектов |
| Конфиг проекта    | `<cwd>/<homeDir>/mcp.json`  | Настройки для конкретного проекта |

`homeDir` задаётся через `NESSY_ACP_HOME_DIR` и по умолчанию равен `.nestor`. Loader, команды
list/update/setup и watcher используют одну пару выбранных путей. Файлы другого `homeDir` не
участвуют в merge и не используются как fallback при отсутствии, удалении или ошибке чтения
выбранного файла.

### Запись конфигурации

`McpConfigStorage` отвечает за чтение, проверку, миграцию и обновление MCP-конфигов. Loader и команды получают его через зависимости. Общий сервис `JsonFileService` инкапсулирует файловые блокировки и атомарную запись; его также использует `McpDisabledToolsStorage`. Экземпляры связываются в `src/index.ts`.

Команды `nestor/mcp/update`, `nestor/mcp/preset` и миграция путей DP используют общую блокировку `proper-lockfile` по реальному пути файла: `<realpath>.lock`. Конфиг перечитывается под блокировкой и записывается через временный файл с атомарным переименованием. Символические ссылки сохраняются: запись меняет целевой файл; ссылка на отсутствующий файл приводит к ошибке. Повреждённый JSON не заменяется пустым конфигом. Блокировка защищает от конкурирующих записей только тех процессов, которые используют этот же механизм.

### Автоматическая перезагрузка

При изменении конфигурационных файлов (глобального или workspace) серверы автоматически перезагружаются. Используется `node:fs.watch` только на выбранных директориях `<home>/<homeDir>/` и `<cwd>/<homeDir>/` с дебаунсом 300мс. Для символических ссылок отслеживаются также директории целевых файлов, включая атомарную замену файла и его удаление с последующим созданием. При изменении ссылки вотчер переключается на новую цель. Вотчер запускается при создании или загрузке сессии.

## Конфигурация по умолчанию (package.json)

Серверы по умолчанию задаются в `package.json` в секции `mcp.default`:

```json
{
    "mcp": {
        "default": {
            "dpSage": {
                "command": "~/.nessy/dp_latest/dp",
                "args": ["ai", "mcp", "sage"],
                "env": { "DP_WORKDIR": "$HOME/.nessy/dp_latest" },
                "autoApprove": ["dp_sage_completion", "dp_sage_groups"],
                "initialState": "disabled"
            },
            "whiteboard": {
                "type": "streamableHttp",
                "url": "https://whiteboard.t-tech.team/mcp",
                "headers": { "X-DP-TOKEN": "$DP_TOKEN" },
                "autoApprove": ["search_boards_by_name"],
                "initialState": "disabled"
            }
        }
    }
}
```

Эта конфигурация загружается при вызове `McpHub.setupDefaults()` (через `nestor/mcp/preset`) и нормализуется:

- Ключ объекта становится полем `name`
- `initialState: "disabled"` преобразуется в `enabled: false`

## Формат данных при создании сессии

При вызове `newSession` / `loadSession` клиент может передать массив `mcpServers`. Каждый элемент — объект с обязательным полем `name`.

### STDIO-сервер

```json
{
    "name": "dpSage",
    "command": "~/.nessy/dp_latest/dp",
    "args": ["ai", "mcp", "sage"],
    "env": [{ "name": "DP_WORKDIR", "value": "$HOME/.nessy/dp_latest" }],
    "autoApprove": ["dp_sage_completion"]
}
```

| Поле          | Тип               | Обязательное | Описание                                |
| ------------- | ----------------- | :----------: | --------------------------------------- |
| `name`        | `string`          |      да      | Уникальное имя сервера                  |
| `command`     | `string`          |      да      | Путь к исполняемому файлу               |
| `args`        | `string[]`        |     нет      | Аргументы командной строки              |
| `env`         | `{name, value}[]` |     нет      | Переменные окружения                    |
| `autoApprove` | `string[]`        |     нет      | Инструменты, не требующие подтверждения |
| `enabled`     | `boolean`         |     нет      | `false` — сервер не подключается        |
| `timeout`     | `number`          |     нет      | Таймаут подключения (мс)                |

### HTTP-сервер

```json
{
    "name": "whiteboard",
    "type": "http",
    "url": "https://whiteboard.t-tech.team/mcp",
    "headers": [{ "name": "Authorization", "value": "Bearer $TOKEN" }],
    "autoApprove": ["search_boards_by_name"]
}
```

| Поле          | Тип               | Обязательное | Описание                                |
| ------------- | ----------------- | :----------: | --------------------------------------- |
| `name`        | `string`          |      да      | Уникальное имя сервера                  |
| `type`        | `"http"`          |      да      | Тип транспорта                          |
| `url`         | `string`          |      да      | URL эндпоинта MCP                       |
| `headers`     | `{name, value}[]` |     нет      | HTTP-заголовки                          |
| `autoApprove` | `string[]`        |     нет      | Инструменты, не требующие подтверждения |
| `enabled`     | `boolean`         |     нет      | `false` — сервер не подключается        |

## Жизненный цикл серверов

### 1. Подключение по умолчанию (до сессии)

Клиент вызывает `nestor/mcp/preset` при инициализации. Это запускает `McpHub.setupDefaults()`, который загружает конфигурации из `package.json` и подключает все серверы с `enabled !== false`.

### 2. Загрузка конфигов при создании/загрузке сессии

При создании или загрузке сессии:

1. `McpConfigLoader.load(cwd, defaultConfigs)` — читает выбранные `<home>/<homeDir>/mcp.json` и `<cwd>/<homeDir>/mcp.json`, мержит с дефолтами из `package.json`
2. `McpHub.applyConfigs(configs)` — приводит состояние серверов к конфигу: удаляет лишние, подключает новые
3. `McpHub.update(params.mcpServers)` — если клиент передал inline-серверы, они добавляются поверх
4. Запускается `McpConfigWatcher` для автоматической перезагрузки при изменении файлов

### Методы обновления серверов

**`applyConfigs(configs)`** — полная синхронизация: серверы, не входящие в конфиг, отключаются и удаляются. Используется при загрузке конфигурационных файлов.

**`update(configs)`** — аддитивное обновление:

1. Новые серверы (не известные хабу) — подключает
2. Уже подключенные — оставляет как есть
3. С `enabled: false` — отключает (если были подключены) и помечает как `disabled`

Серверы **не удаляются** при вызове `update()` — только добавляются или отключаются. Используется для inline-серверов из параметров сессии.

### Статусы серверов

| Статус         | Описание                                             |
| -------------- | ---------------------------------------------------- |
| `connected`    | Подключен, инструменты доступны                      |
| `disabled`     | Отключен по конфигурации (`enabled: false`)          |
| `error`        | Ошибка подключения (бинарник не найден, сеть и т.д.) |
| `disconnected` | Отключен после `disconnectAll()`                     |

При ошибке подключения (например, бинарник `~/.nessy/dp_latest/dp` отсутствует) сервер помечается как `error`, остальные серверы продолжают подключаться.

## Метаданные MCP в A2A-сообщениях

Подключенные серверы и их инструменты отправляются в каждом промпте как метаданные. `McpMetadataProvider` собирает данные из `McpHub` и формирует блок:

### Формат метаданных в promptContent

```json
{
    "type": "metadata",
    "key": "mcp",
    "content": [
        {
            "name": "dpSage|dp_sage_completion",
            "type": "function",
            "description": "Converts a natural language prompt into a valid MageQL query...",
            "parameters": {
                "type": "object",
                "properties": {
                    "g": { "description": "Sage logging group name", "type": "string" },
                    "s": { "description": "System name", "type": "string" },
                    "p": { "description": "Natural language description", "type": "string" }
                },
                "required": ["g", "s", "p"]
            }
        }
    ]
}
```

### Формат в A2A-метаданных (после extractMetadata)

```json
{
  "mcp": {
    "content": [
      {
        "name": "dpSage|dp_sage_completion",
        "type": "function",
        "description": "...",
        "parameters": { ... }
      }
    ]
  }
}
```

Формат имени инструмента: `{serverName}|{toolName}`.

Поля `description` и `parameters` берутся из MCP-схемы инструмента (`listTools()` при подключении к серверу).

## Внешние методы (extMethod)

### `nestor/mcp/preset`

Загружает и подключает MCP-серверы по умолчанию из `package.json > mcp.default`. Вызывается клиентом при инициализации, до создания сессии.

**Параметры:** не требуются

**Ответ:**

```json
{ "ok": true }
```

Внутри выполняется команда `setupDefaultMcpCommand`, которая вызывает `McpHub.setupDefaults()`. Если `McpHub` не инициализирован — метод завершается без ошибки.

### `nestor/mcp/list`

Возвращает список всех доступных MCP-инструментов со всех подключённых серверов.

**Параметры:** не требуются

**Ответ:**

```json
{
    "tools": [
        {
            "server": "dpSage",
            "tool": {
                "name": "dp_sage_completion",
                "description": "Converts a natural language prompt into a valid MageQL query",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "g": { "description": "Sage logging group name", "type": "string" },
                        "s": { "description": "System name", "type": "string" },
                        "p": { "description": "Natural language description", "type": "string" }
                    },
                    "required": ["g", "s", "p"]
                }
            }
        },
        {
            "server": "dpSage",
            "tool": {
                "name": "dp_sage_groups",
                "description": "Returns available Sage logging groups for a given system",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "s": { "description": "System name", "type": "string" }
                    },
                    "required": ["s"]
                }
            }
        },
        {
            "server": "whiteboard",
            "tool": {
                "name": "search_boards_by_name",
                "description": "Search for whiteboards by name",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "description": "Search query string", "type": "string" }
                    },
                    "required": ["query"]
                }
            }
        }
    ]
}
```

Если серверы не подключены или `McpHub` не инициализирован — возвращается пустой массив:

```json
{ "tools": [] }
```

Каждый элемент массива содержит:

| Поле               | Тип       | Описание                           |
| ------------------ | --------- | ---------------------------------- |
| `server`           | `string`  | Имя MCP-сервера                    |
| `tool.name`        | `string`  | Имя инструмента                    |
| `tool.description` | `string?` | Описание инструмента               |
| `tool.parameters`  | `object?` | JSON Schema параметров инструмента |

### `nestor/mcp/update`

Принимает `configFile` и массив `servers`. Для каждого сервера `name` поле
`isActive` обновляет `enabled` в указанном конфиге, не заменяя остальные параметры.

Необязательный массив `tools` содержит пары `name` и `isActive`. Обновляются только
переданные методы: `false` добавляет запрет, `true` снимает его. Состояния остальных
методов сохраняются, даже если они временно отсутствуют в `nestor/mcp/list`.
Пустой или отсутствующий `tools` не сбрасывает запреты. Они хранятся отдельно,
по текущему cwd и имени сервера, в `mcp-disabled.json`.

Хранилище перечитывается под блокировкой перед изменением. Если выбора для сервера
ещё нет, начальные ограничения берутся из актуального мержа глобального и
workspace-конфигов, а не из состояния подключённого хаба. Ошибка чтения конфигов
прерывает обновление, не сбрасывая ограничения.

## Ключевые файлы

| Файл                                        | Назначение                                                |
| ------------------------------------------- | --------------------------------------------------------- |
| `src/mcp/mcp-hub.ts`                        | Центральный хаб — подключение, обновление, поиск серверов |
| `src/mcp/mcp-config-loader.ts`              | Чтение и мерж конфигурационных файлов                     |
| `src/mcp/mcp-config-storage.ts`             | Чтение, проверка, миграция и обновление MCP-конфигов      |
| `src/utils/json-file-service.ts`            | Файловый сервис с блокировками и атомарной записью        |
| `src/mcp/mcp-config-watcher.ts`             | Автоперезагрузка при изменении конфигов (`fs.watch`)      |
| `src/mcp/mcp-tools-file-storage.ts`         | Файловое хранилище состояния MCP-инструментов             |
| `src/adapter/mcp/mcp-client.ts`             | Клиент MCP-сервера, обнаружение инструментов              |
| `src/adapter/mcp/connect.ts`                | Фабрика подключений (stdio / http)                        |
| `src/metadata/mcp/provider.ts`              | Провайдер метаданных для A2A-сообщений                    |
| `src/adapter/a2a/utils.ts`                  | `extractMetadata()` — трансформация в формат A2A          |
| `src/commands/setup-default-mcp.command.ts` | Команда `nestor/mcp/preset`                               |
| `src/commands/mcp-list.command.ts`          | Команда `nestor/mcp/list`                                 |
| `src/types.ts`                              | `IMcpHub`, `TMcpConfigFile`, `TMcpServerConfig`           |
