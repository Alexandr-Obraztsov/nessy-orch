# Error Handling Guide

Единая иерархия типизированных ошибок для `nessy-acp-agent` плюс инструменты,
которые удерживают её в рабочем состоянии (ESLint + pre-commit hook).

- [Hierarchy](#hierarchy) — какие классы существуют и как они связаны
- [Error codes](#error-codes) — типизированный `TErrorCode`
- [Throwing typed errors](#throwing-typed-errors) — примеры по категориям
- [A2A connection errors](#a2a-connection-errors) — `requestId`, классификация и сообщения
- [Wrapping caught errors](#wrapping-caught-errors) — `cause`, `context`
- [Logging](#logging) — `logError()`
- [Enforcement](#enforcement) — ESLint rules + pre-commit hook
- [FAQ](#faq)

---

## Hierarchy

```
BaseError (abstract)
├── TransportError
│   └── A2AError
│       ├── A2ARetryableError      (429, -32001 - можно повторить)
│       └── A2APersistentError     (постоянные сбои протокола)
├── AgentError
│   ├── SessionError
│   │   ├── SessionNotFoundError
│   │   └── SessionInvalidModeError
│   ├── ToolError
│   │   └── ToolCancelledError
│   ├── CancellationError
│   ├── SkillError
│   │   ├── SkillNotFoundError
│   │   └── SkillInvalidMetadataError
│   └── FileError
│       ├── FileTooLargeError
│       ├── FileReadError
│       └── FileWriteError
├── TurnError
│   ├── TurnRetryableError         (turn можно повторить с retry-marker)
│   └── TurnPersistentError        (turn провалился окончательно)
├── ConfigurationError
└── CommandError
    └── CommandExecutionError
```

`BaseError` несёт общий контракт:

```typescript
abstract class BaseError extends Error {
    public readonly code: TErrorCode;
    public readonly cause?: unknown;
    public readonly context?: TErrorContext;
    public readonly timestamp: string;

    toJSON(): Record<string, unknown>;
}
```

Все наследники прокидывают `code` / `cause` / `context` в `super()` через свои
конструкторы. Числовые коды A2A/JSON-RPC мапятся в `TErrorCode` через
`mapA2ACodeToTypedCode()` — единая точка трансляции.

---

## Error codes

```typescript
type TErrorCode =
    // A2A / Transport
    | 'A2A_RATE_LIMIT'
    | 'A2A_TASK_NOT_FOUND'
    | 'A2A_METHOD_NOT_FOUND'
    | 'A2A_INVALID_REQUEST'
    | 'A2A_INTERNAL_ERROR'
    | 'A2A_CONNECTION_ERROR'
    | 'A2A_TIMEOUT'
    // Agent / Session
    | 'SESSION_NOT_FOUND'
    | 'SESSION_INVALID_MODE'
    // Tool / Skill
    | 'TOOL_CANCELLED'
    | 'SKILL_NOT_FOUND'
    | 'SKILL_INVALID_METADATA'
    // Cancellation
    | 'ABORTED_BY_USER'
    // File operations
    | 'FILE_TOO_LARGE'
    | 'FILE_WRITE_ERROR'
    | 'FILE_READ_ERROR'
    // Command
    | 'COMMAND_EXECUTION_FAILED'
    // Configuration
    | 'CONFIG_INVALID'
    // Generic
    | 'UNKNOWN_ERROR';
```

Если приходится добавлять новый код — его обязательно должен бросать какой-нибудь
конструктор: иначе он будет orphan и его удалит первый же rg-проход.

---

## Throwing typed errors

### A2A errors

`createA2AError()` (`src/adapter/a2a/a2a-errors.ts`) - единственная точка, где
A2A-сбой превращается в типизированную ошибку:

```typescript
import { createA2AError } from '../adapter/a2a/a2a-errors.js';

throw createA2AError({ code: 429, message: 'rate limited', id: 'task-x' }, requestId);
// → A2ARetryableError, code='A2A_RATE_LIMIT'

throw createA2AError({ code: -32603, message: 'internal_error', id: 'task-x' });
// → A2APersistentError, code='A2A_INTERNAL_ERROR'
```

Конструкторы вручную обычно не вызывают, но если нужно:

```typescript
new A2ARetryableError('rate limited', { code: 429, requestId: 'req-1' });
new A2APersistentError('A2A_INTERNAL_ERROR', 'server crashed', { errorCode: -32603 });
```

### Sessions

```typescript
throw new SessionNotFoundError(sessionId, { cwd });
throw new SessionInvalidModeError(sessionId, modeId);
```

### Tools

```typescript
throw new ToolCancelledError('read_file');
```

### Cancellation

```typescript
throw new CancellationError('ABORTED_BY_USER', 'cancelled');
```

### Skills

```typescript
throw new SkillNotFoundError(skillName);
throw new SkillInvalidMetadataError(skillPath, 'frontmatter missing name', { cause: err });
```

### Files

```typescript
throw new FileTooLargeError(filePath);
throw new FileReadError(filePath, 'Permission denied', { cause: err });
throw new FileWriteError(filePath, 'Disk full', { cause: err });
```

### Turn (failure classification)

Бросает `handleA2aErrorCommand`, ловит `Turn.consume()`. Класс определяет,
покажет ли UI retry-marker или зафиналит turn как failed:

```typescript
throw new TurnRetryableError({ code: 429, message: 'rate limited', requestId });
throw new TurnPersistentError('internal_error', -32603);
```

### Commands

```typescript
throw new CommandExecutionError('execute_command', 'Execution failed', { cause: err });
```

### Configuration

```typescript
throw new ConfigurationError('Invalid NESSY_ACP_HOME_DIR', {
    context: { setting: 'NESSY_ACP_HOME_DIR' },
});
```

---

## A2A connection errors

Для каждого запроса к A2A `nessy-acp-agent` генерирует новый UUID и передаёт его
в заголовке `X-Request-Id`. Это относится и к загрузке agent card, и к запросам
внутри созданной сессии.

`requestId` добавляется в контекст ошибки только после получения HTTP-ответа.
Если запрос не дошёл до backend из-за DNS, TLS или сетевой ошибки, такого
`requestId` в ошибке нет: коррелировать его с серверными логами невозможно.
Ошибки, пришедшие от backend в A2A-событии, сохраняют серверный `requestId` при
преобразовании в `TurnRetryableError` или `TurnPersistentError`.

Ошибки соединения классифицируются по `code` во всей цепочке `cause`:

| `errorKind`   | Примеры кодов                                                    | Сообщение пользователю                                 |
| ------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| `dns`         | `ENOTFOUND`, `EAI_AGAIN`, `DNSResolveFailed`                     | URL не удалось разрешить через DNS                     |
| `certificate` | `CERT_UNTRUSTED`, `DEPTH_ZERO_SELF_SIGNED_CERT`, другие TLS-коды | TLS-сертификат не удалось проверить                    |
| `network`     | `ECONNREFUSED`, `ConnectionRefused`, `Timeout`                   | Сеть недоступна или соединение было прервано           |
| `unknown`     | код отсутствует или неизвестен                                   | Общее сообщение о невозможности подключиться к backend |

Если в агрегированной ошибке присутствуют коды нескольких стадий соединения,
приоритет соответствует порядку установления соединения:
`dns` → `certificate` → `network` → `unknown`. В контекст ошибки записываются
`errorKind` и все найденные `errorCodes`.

Такая классификация применяется при создании/загрузке сессии. Если соединение
обрывается во время активного A2A-стрима, известная DNS, TLS или сетевая ошибка
также оборачивается в `AgentError('A2A_CONNECTION_ERROR', ...)`; остальные
ошибки и отмены пробрасываются без изменений.

---

## Wrapping caught errors

Когда ловим ошибку и бросаем свою — всегда передаём оригинал в `cause`, чтобы
не потерять стек:

```typescript
try {
    await fs.readFile(path);
} catch (err) {
    throw new FileReadError(path, 'Read failed', { cause: err });
}
```

`TErrorContext` свободной формы, но есть «знакомые» поля, которые удобно
заполнять (используются логгером и UI):

```typescript
interface TErrorContext {
    sessionId?: string;
    turnId?: string;
    toolCallId?: string;
    toolName?: string;
    serverName?: string;
    requestId?: string;
    cwd?: string;
    [key: string]: unknown;
}
```

---

## Logging

`logError()` — единый вход для логирования. Пишет в stderr + project log, с
кодом и контекстом:

```typescript
import { logError } from '../errors/log-error.js';

try {
    await someOperation();
} catch (err) {
    logError(err, 'Failed to execute operation', {
        level: 'error',
        context: { sessionId, operationId },
    });
    throw err;
}
```

Уровни: `debug` · `info` · `warn` · `error` (default) · `critical`. Стек
печатается только для `error` / `critical`.

---

## Enforcement

### ESLint rules (`eslint-rules/error-handling.js`)

| Правило                       | Уровень | Что проверяет                                                   |
| ----------------------------- | ------- | --------------------------------------------------------------- |
| `nessy/no-bare-throw-errors`  | error   | `throw new Error()` запрещён; нужен типизированный класс        |
| `nessy/no-empty-catch`        | error   | Пустой `catch { }` не разрешён                                  |
| `nessy/require-error-logging` | warn    | В `catch` перед `throw <new wrapped>` должен быть `logError()`  |
| `nessy/require-error-cause`   | warn    | Если в throw упомянут пойманный `err`, должен быть `cause: err` |

Тесты освобождены от первых двух (`src/__tests__/**/*.ts` в
`eslint.config.mjs`).

Запуск:

```bash
npm run lint        # prettier + eslint + tsc + knip
npm run lint:fix    # автоисправления eslint
```

### Pre-commit hook (`.githooks/pre-commit`)

Тонкий шим: собирает staged `.ts` в `src/`, запускает `eslint --max-warnings 0`
на них. ESLint и hook — один источник истины.

Установка (из корня репо):

```bash
git config core.hooksPath nessy-acp-agent/.githooks
```

или симлинком:

```bash
ln -sf ../../nessy-acp-agent/.githooks/pre-commit .git/hooks/pre-commit
```

### IDE

- **VS Code**: расширение [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) подсветит нарушения в реальном времени.
- **JetBrains**: `Settings → Languages & Frameworks → JavaScript → Code Quality Tools → ESLint`.

### CI

```yaml
lint:
    stage: test
    script:
        - npm run lint
        - npm run build
```

---

## FAQ

**Q: Почему `throw new Error()` запрещён?**
A: Без типа ошибки невозможно разделить retryable/persistent, нет `code` для
маршрутизации и нет `context` для логов. Каждый `throw new Error()` — это
будущий silent failure.

**Q: Можно ли отключить правило для конкретного случая?**
A: Да: `// eslint-disable-next-line nessy/no-bare-throw-errors`. Но почти
всегда правильнее завести новый класс.

**Q: Почему в тестах правила отключены?**
A: Тесты часто бросают «маркер»-ошибки внутри моков, где типизация не несёт
смысла. Правила релаксированы только в `src/__tests__/**`.

**Q: Что делать с `RetryableError` из `a2a-errors.ts`?**
A: `@deprecated`. Прод-код использует `createA2AError()`, который возвращает
`A2ARetryableError` / `A2APersistentError`. `RetryableError` остаётся только
для тестов, которые имитируют сырой A2A error.

---

## Checklist для нового кода

- [ ] Использован типизированный класс из `src/errors/index.ts`
- [ ] В `context` есть релевантные поля (`sessionId`, `toolCallId`, `filePath` и т. п.)
- [ ] Если оборачиваем — пробросили `cause: err`
- [ ] Перед `throw <new wrapped>` стоит `logError()` (или эквивалент)
- [ ] Тесты адаптированы под новый тип / сообщение
