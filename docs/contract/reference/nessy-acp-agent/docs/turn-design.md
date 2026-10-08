# Дизайн: Turn-ориентированная архитектура

## Цели

1. Ввести явный объект `Turn`, моделирующий один обмен сообщениями между пользователем и удалённым агентом.
2. Сократить `A2ABridge` до транспортного слоя — без знания о цикле tool-call, suspend-for-input, отклонениях бэкенда и т.п.
3. Сделать `Turn` координатором, а не исполнителем: он только переключает состояния, диспетчирует команды и публикует события. Тяжёлая работа остаётся в командах и сервисах.
4. У `Turn` минимальные зависимости — только `EventBus` и `CommandRunner` (плюс собственные id, sessionId, signal).
5. Все сложные сценарии (открытие потока, отправка результатов инструментов, ретраи) оформлены как commands.

## Три контекста

| Контекст    | Время жизни                                          | Где живёт             | Что хранит                                                                                                                                                           |
| ----------- | ---------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App**     | весь процесс                                         | `index.ts → init`     | `EventBus`, `CommandRunner`, `SessionManager`, `McpHub`, `SkillRegistry`, `EnvironmentService`, фабрики мостов и инструментов, провайдер токена, метадата-провайдеры |
| **Session** | от `newSession`/`loadSession` до завершения процесса | `SessionManager`      | `id`, `cwd`, `history`, `modes`, `permissions`, `tools`, `bridge`, `contextId`, `taskId`, `pendingPrompt`, `currentTurn?`                                            |
| **Turn**    | от стартового prompt до терминального состояния      | `Session.currentTurn` | `id`, `sessionId`, `status`, `signal`, локальный лог взаимодействий, `pendingToolResults`, флаги текущего раунда                                                     |

Сессия — последовательность Turn'ов. Между ними сессия живёт, Turn нет.

## Жизненный цикл Turn

```
                 ┌── cancel() ──────────────────┐
                 ▼                              │
   idle ─── start ──► forwarding ──► streaming ─┤
                                       │   ▲    │
                                       │   │    │
                                       ▼   │    │
                                  tools_executing
                                       │   │    │
                                       │   │    │
                          (стрим закончился, есть pending tool results)
                                       │
                                       ▼
                              ┌── continue ────► streaming (round n+1)
                              │
                              │── suspend ─────► suspended  (input-required, ждём след. prompt)
                              │
                              │── complete ────► completed
                              │
                              │── fail ────────► failed | failed_retryable
                              │
                              └── cancel ──────► cancelled
```

**Статусы:**

- `idle` — объект создан, но `start` ещё не вызван.
- `forwarding` — отправляем стартовые `parts` через транспорт.
- `streaming` — читаем поток событий от удалённого агента.
- `tools_executing` — диспетчим `toolCallCommand` по входящим `tool_call` событиям (внутри `streaming`-цикла).
- `suspended` — финальное состояние раунда: пришёл `input-required` с видимым сообщением, ждём следующего пользовательского prompt.
- `completed` — нормальное завершение (стрим закрылся без pending results).
- `failed` — терминальная ошибка (persistent).
- `failed_retryable` — ошибка, для которой имеет смысл `regenerate` (rate limit, stream error и т.п.). Turn завершён, но в журнале остаётся retryable-сообщение об ошибке.
- `cancelled` — `signal` сработал.

Переходы строго через приватный `transition(to)`, который публикует `turnStatusChanged` на шину.

## Виды взаимодействий внутри Turn

`Turn` обрабатывает поток типизированных `TStreamEvent` (domain-level, не A2A-wire). Каждое событие — одно из:

- `context` — получили/обновили `contextId`.
- `task_status` — обновили `taskId`/`taskStatus` (включая `input-required`, `working`, `completed`). Несёт также `hasVisibleMessage: boolean` (вычислен транспортом по сопровождающим частям сообщения) для корректного suspend-решения.
- `agent_text` — кусок текстового ответа агента (видимое сообщение).
- `data_chunk` — DataPart, не распознанный как `tool_call` или stream-error: эмитится как JSON-сообщение (fallback).
- `tool_call` — агент попросил выполнить инструмент.

Терминальные ошибки (`TurnRetryableError`, `TurnPersistentError`) **не приходят как события стрима** — они вылетают из итерирования (создаются в `handleA2aErrorCommand` и пробрасываются через `streamWithRetry`), и `consume()` ловит их через try/catch.

Параллельно Turn внутри себя оперирует «исходящими» взаимодействиями:

- `pendingToolResults` (заполняется в текущем раунде) → парты следующего раунда;
- `outgoingResults` + `backendRejection` (локальные `let` в `start`) — для retry-c-error-результатом, если бэкенд отклонил отправку tool results;
- разрешения (`permissionRequested` / `permissionResolved`) фактически обрабатываются `toolCallCommand` — Turn не знает деталей.

Долгосрочная история событий ведётся в журнале сессии через шину событий — Turn не сохраняет ничего persistently.

## Поведение Turn (без A2A-специфики)

### Старт

```ts
async start(args: TTurnStartArgs, signal: AbortSignal): Promise<TTurnOutcome>
```

`args` содержит то, что нужно для первого forward: `initialParts`, `modeId?`, `metadata?`, `isRetry?`. `signal` приходит отдельно (берётся из `session.pendingPrompt` в командах, создавших Turn). Никаких упоминаний A2A.

### Цикл раундов

```ts
let parts = args.initialParts;
let isContinuation = false;
let metadataToSend = args.metadata;
let outgoingResults: TToolCallResultWithContext[] = [];
let backendRejection: string | null = null;

this.transition('forwarding');
while (true) {
    if (signal.aborted) return this.finalize('cancelled');
    this.transition('streaming');
    this.pendingToolResults = [];

    const stream = await this.commandRunner.run(forwardToAgentCommand, {
        sessionId: this.sessionId,
        parts,
        contextId: this.contextId,
        modeId: args.modeId,
        metadata: metadataToSend,
        isContinuation,
        signal,
    });

    const outcome = await this.consume(stream, signal);

    if (outcome.kind === 'cancelled') return this.finalize('cancelled');
    if (outcome.kind === 'failed_retryable') {
        /* emit error msg */ return this.finalize('failed_retryable');
    }
    if (outcome.kind === 'failed_persistent') {
        if (isContinuation && outgoingResults.length > 0 && backendRejection === null) {
            backendRejection = outcome.error.message;
            this.reportPendingToolFailures(outgoingResults, backendRejection);
            parts = outgoingResults.map((r) => ({
                kind: 'tool_result',
                toolCallId: r.id,
                error: backendRejection,
            }));
            metadataToSend = undefined;
            continue;
        }
        if (backendRejection !== null) return this.finalize('completed'); // soft-fail
        /* emit error msg */
        return this.finalize('failed');
    }
    if (outcome.kind === 'suspend') return this.finalize('suspended');

    if (this.pendingToolResults.length === 0) return this.finalize('completed');

    outgoingResults = this.pendingToolResults;
    parts = outgoingResults.map((r) => ({
        kind: 'tool_result',
        toolCallId: r.id,
        content: r.result,
        error: r.error,
    }));
    backendRejection = null;
    metadataToSend = undefined;
    isContinuation = true;
}
```

`forwardToAgentCommand` возвращает `AsyncIterable<TStreamEvent>` — Turn потребляет события, не зная о транспортных деталях. Сама команда (см. ниже) уже содержит логику ретраев на транспортном уровне.

### Обработка одного события

```ts
private async onStreamEvent(e: TStreamEvent, signal: AbortSignal): Promise<boolean> {
  switch (e.kind) {
    case 'context':
      this.contextId = e.contextId;
      this.eventBus.emit(sessionUpdate, { sessionId: this.sessionId, contextId: e.contextId });
      return false;

    case 'task_status':
      this.taskId = e.taskId;
      this.eventBus.emit(sessionUpdate, { sessionId: this.sessionId, taskId: e.taskId, taskStatus: e.status });
      if (e.status === 'input-required' && this.shouldSuspend(e.hasVisibleMessage)) return true;
      return false;

    case 'agent_text':
      this.eventBus.emit(message, { sessionId: this.sessionId, messageId: e.messageId, text: e.text, target: 'nessyAcp' });
      return false;

    case 'data_chunk':
      this.eventBus.emit(message, { sessionId: this.sessionId, messageId: e.messageId, text: JSON.stringify(e.data), target: 'nessyAcp' });
      return false;

    case 'tool_call': {
      this.transition('tools_executing');
      const result = await this.commandRunner.run(toolCallCommand, { sessionId: this.sessionId, toolCall: e.toolCall });
      this.transition('streaming');
      if (result && !isTerminalTool(result.toolCall.name)) this.pendingToolResults.push(result);
      return false;
    }
  }
}
```

Решение о suspend: `shouldSuspend(hasVisibleMessage) = hasVisibleMessage || pendingToolResults.length === 0`. `hasVisibleMessage` определяется транспортом для конкретного `task_status` события (исходя из частей сопровождающего сообщения), а не накапливается через раунд — это сохраняет семантику исходного `shouldSuspendForInput`.

Ошибки `TurnRetryableError` / `TurnPersistentError` не приходят как события стрима — они вылетают из итерирования `for await`, и `consume()` ловит их через try/catch, превращая в `TConsumeOutcome`.

### Отмена

`Turn` владеет только `signal: AbortSignal`. Реальная отмена приходит из `SessionManager.cancel(sessionId)`, который аборт-ит `pendingPrompt`. Turn замечает `signal.aborted` в цикле, прокидывает его в `forwardToAgentCommand` → `bridge.sendInitial/Continuation` → A2A SDK; стрим закрывается. Если есть `taskId`, обработчик `cancelPrompt` в `index.ts` вызывает `session.bridge.cancelTask(taskId)` (отдельная команда для этого не заведена — текущая реализация делает это инлайн в подписке на событие).

## Класс Turn — скелет

```ts
export type TTurnStatus =
    | 'idle'
    | 'forwarding'
    | 'streaming'
    | 'tools_executing'
    | 'suspended'
    | 'completed'
    | 'failed'
    | 'failed_retryable'
    | 'cancelled';

export type TTurnStartArgs = {
    initialParts: TDomainPart[];
    modeId?: string;
    metadata?: Record<string, unknown>;
    isRetry?: boolean;
};

export type TTurnOutcome = {
    status: TTurnStatus;
    stopReason: 'end_turn' | 'cancelled';
};

export class Turn {
    public status: TTurnStatus = 'idle';
    public contextId?: string;
    public taskId?: string;

    private pendingToolResults: TToolCallResultWithContext[] = [];

    constructor(
        public readonly id: string,
        public readonly sessionId: string,
        private readonly eventBus: EventBus,
        private readonly commandRunner: CommandRunner,
    ) {}

    async start(args: TTurnStartArgs, signal: AbortSignal): Promise<TTurnOutcome> {
        /* … */
    }

    private async consume(
        stream: AsyncIterable<TStreamEvent>,
        signal: AbortSignal,
    ): Promise<TConsumeOutcome> {
        /* … */
    }
    private async onStreamEvent(e: TStreamEvent, signal: AbortSignal): Promise<void> {
        /* … */
    }
    private shouldSuspend(): boolean {
        /* … */
    }
    private transition(to: TTurnStatus): void {
        /* publishes turnStatusChanged */
    }
    private finalize(status: TTurnStatus): TTurnOutcome {
        /* publishes turnEnded */
    }
}
```

Зависимости — ровно `EventBus` и `CommandRunner`. Никаких `bridge`, `SessionManager`, `PermissionService` напрямую.

## Доступ к зависимостям в командах

Все команды реализуют единый контракт:

```ts
export interface ICommand<TPayload, TResult> {
    name: string;
    execute(this: CommandRunner, payload: TPayload): Promise<TResult>;
}

export class CommandRunner {
    constructor(public readonly deps: TCommandDeps) {}
    async run<P, R>(command: ICommand<P, R>, payload: P): Promise<R> {
        return command.execute.call(this, payload);
    }
}
```

Внутри `execute`:

- `this` — экземпляр `CommandRunner` (`execute.call(this, payload)` это обеспечивает).
- `this.deps` — общий пакет зависимостей.
- `this.run(otherCommand, payload)` — диспетчеризация под-команд.

Поэтому команды читаются как методы рантайма:

```ts
async execute({ sessionId, ... }: TPayload) {
    const { deps } = this;
    const session = deps.sessionManager.get(sessionId);
    // ...
    const result = await this.run(otherCommand, { ... });
}
```

`Turn` создаётся внутри команды и получает рантайм через `this`: `new Turn(id, sessionId, deps.eventBus, this)`. Никаких ссылок на `commandRunner` в `TCommandDeps` нет.

## Новые / изменённые команды

### `forwardToAgentCommand` (новая)

Транспортная команда — главный seam между `Turn` и мостом. Возвращает `AsyncIterable<TStreamEvent>`. Внутри:

1. Достаёт `session.bridge` из `SessionManager`.
2. Создаёт `A2ARetryManager` на одну стрим-сессию.
3. Возвращает генератор `streamWithRetry`, который в цикле:
    - вызывает `bridge.sendInitial(args)` / `bridge.sendContinuation(args)` и пробрасывает события через `yield*`;
    - на любое исключение диспетчит `this.run(handleA2aErrorCommand, { err, signal, retryManager })`;
    - команда либо возвращает (значит ретраим — повторяем итерацию), либо бросает типизированную ошибку (значит выходим).

Цикл ретраев живёт здесь, не в мосте.

```ts
async execute(payload: TForwardToAgentPayload) {
    const session = this.deps.sessionManager.get(payload.sessionId);
    if (!session?.bridge) throw new Error(...);

    const args: TTransportSendArgs = { /* ... из payload ... */ };
    return streamWithRetry(session.bridge, args, payload.isContinuation, this);
}

async function* streamWithRetry(bridge, args, isContinuation, runner) {
    const retryManager = new A2ARetryManager();
    for (;;) {
        try {
            yield* isContinuation ? bridge.sendContinuation(args) : bridge.sendInitial(args);
            return;
        } catch (err) {
            await runner.run(handleA2aErrorCommand, { err, signal: args.signal, retryManager });
        }
    }
}
```

### `handleA2aErrorCommand` (новая)

Stateless классификатор A2A-ошибок. Контракт: «возврат — это ретрай, throw — это конец».

Payload: `{ err: unknown; signal: AbortSignal; retryManager: A2ARetryManager }`. Решения в порядке проверки:

1. `signal.aborted` → re-throw err.
2. `err instanceof RetryableError` (стрим-ошибка из DataPart) → throw `TurnRetryableError`.
3. `isPersistentError(err)` (network/JSON-RPC persistent codes) → throw `TurnPersistentError`.
4. Код = `RATE_LIMIT_ERROR_CODE` (429) → `retryManager.handleRateLimitRetry(signal)` (со сном); если можно — return (=ретрай), иначе throw `TurnPersistentError`.
5. Иначе — transient: `retryManager.handleServerErrorRetry()` (счётчик); если можно — return (=ретрай), иначе throw `TurnPersistentError`.

Это единственное место в коде, где известны коды A2A-ошибок и политика ретраев. Если когда-нибудь появится второй транспорт, по аналогии заведётся `handleXxxErrorCommand` и плагинируется в свой `forwardToAgentCommand`-аналог.

### `handlePromptCommand` (изменена)

```ts
async execute({ sessionId, promptContent, userMessageId, source }: THandlePromptPayload) {
    const { deps } = this;
    const session = deps.sessionManager.get(sessionId);
    if (!session) throw new Error(...);

    deps.sessionManager.recordUserMessage(sessionId, userText, userMessageId, promptContent);
    const signal = deps.sessionManager.startPrompt(sessionId);
    const pendingToolCallId = session.pendingToolCall?.id;
    deps.sessionManager.setPendingToolCall(sessionId, undefined);

    try {
        if (!session.isAttached || !session.bridge) { /* emit message + return */ }

        const metadataBlocks = await collectSessionMetadata(deps, session);
        const forwardContent = metadataBlocks.length ? [...promptContent, ...metadataBlocks] : promptContent;
        const promptText = promptContentToText(forwardContent) || userText;
        const metadata = extractMetadata({ promptContent: forwardContent, cwd: session.cwd });
        const initialParts = buildInitialParts({ promptText, pendingToolCallId });

        const turn = new Turn(crypto.randomUUID(), sessionId, deps.eventBus, this);
        await turn.start({ initialParts, modeId: session.modes?.currentModeId, metadata }, signal);

        return signal.aborted ? 'cancelled' : 'end_turn';
    } catch (err) {
        /* unexpected — emit + return 'end_turn' */
    } finally {
        deps.sessionManager.finishPrompt(sessionId);
    }
}
```

Никакого `AgentError`-плумбинга — Turn сам публикует `message` события с error-метой через свои `failed_retryable` / `failed` ветки.

### `regenerateAgentTurnCommand` (изменена)

Симметрично: вместо двух веток `bridge.forward(..., { retry: true })` / `bridge.forward(text, ...)` собирает `initialParts` (`{kind:'retry_marker'}` либо парты последнего пользовательского сообщения), удаляет последнюю retryable-ошибку через `sessionManager`, создаёт `Turn` с `isRetry: true` и запускает.

### `toolCallCommand` (без изменений по смыслу)

Уже хорошо изолирован. Turn вызывает его через `this.commandRunner.run(toolCallCommand, …)`. Сигнатура `execute` теперь `({ sessionId, toolCall }: TToolCallPayload)` (deps берётся из `this.deps`), всё остальное прежнее.

## Транспорт после рефакторинга

`A2ABridge` сокращается до:

```ts
interface IAgentBridge {
    sendInitial(args: TTransportSendArgs): AsyncIterable<TStreamEvent>;
    sendContinuation(args: TTransportSendArgs): AsyncIterable<TStreamEvent>;
    cancelTask(taskId: string): Promise<void>;
    getModes(): Promise<TSessionModes | undefined>;
}
```

`TTransportSendArgs` — домейн-уровень: `sessionId`, `parts: TDomainPart[]`, `contextId?`, `modeId?`, `metadata?`, `signal`.

`sendInitial`/`sendContinuation` идентичны по реализации (обе вызывают приватный `openStream`) — разделение существует ради ясности контракта на уровне команды (см. `forwardToAgentCommand`).

**Что остаётся в A2A-слое:**

- мапперы A2A-wire ↔ `TStreamEvent` (`adapter/a2a/utils.ts` + `partsToStreamEvents` в самом мосте),
- `RetryableError` как **внутренний транспортный сигнал** (бросается из `partsToStreamEvents` при обнаружении `isStreamErrorData`),
- сборка `A2AMessage` с `metadata.agent_settings`,
- `cancelTask` через A2A SDK,
- `getModes` (читает AgentCard через `readAgentModes`),
- `A2ARetryManager` (живёт в `adapter/a2a/`, но **инстанциируется в команде**, не в мосте),
- классификация `isPersistentError` / `extractErrorCode` / `RATE_LIMIT_ERROR_CODE` (используется командой `handleA2aErrorCommand`).

**Что уходит из моста:**

- цикл tool-call (`pendingResults` round-trip) → в `Turn`,
- `shouldSuspendForInput` → в `Turn` (как `shouldSuspend(hasVisibleMessage)`),
- бэкенд-rejection bookkeeping → в `Turn`,
- диспетчеризация `toolCallCommand` → в `Turn`,
- `extractMetadata` (сборка metadata из `promptContent`) → в `handlePromptCommand` / `regenerateAgentTurnCommand`,
- **классификация ошибок и сама петля ретраев** → в `handleA2aErrorCommand` + `forwardToAgentCommand` (мост просто бросает «сырой» Error при сбое стрима, кроме `RetryableError` из DataPart),
- эмиссия `sessionUpdate` / `message` событий → в `Turn`,
- ссылка на `Client` в публичном интерфейсе → инкапсулирована в `A2ABridge`; для чтения card используется `getModes`.

После расчистки `A2ABridge` ≈ 196 строк (было ~430): по сути это «открыть стрим, перевести wire-события в домейн, бросить наружу при сбое».

## События (изменения в `core/events.ts`)

Добавить:

```ts
export type TTurnStartedEvent = { sessionId: TSessionId; turnId: string };
export type TTurnStatusChangedEvent = {
    sessionId: TSessionId;
    turnId: string;
    status: TTurnStatus;
};
export type TTurnEndedEvent = { sessionId: TSessionId; turnId: string; status: TTurnStatus };

export const turnStarted = createEvent<TTurnStartedEvent>('turnStarted');
export const turnStatusChanged = createEvent<TTurnStatusChangedEvent>('turnStatusChanged');
export const turnEnded = createEvent<TTurnEndedEvent>('turnEnded');
```

Остальные события (`message`, `toolCallStarted/Completed/Failed`, `sessionUpdate`, `modeChanged`) остаются.

## Компонентная схема

### Слои и контексты

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  App context  (index.ts → init)                                              │
│  ───────────────────────────────────────────────────────────────────────────  │
│  EventBus     CommandRunner(deps)     NessyAgent (ACP adapter)               │
│  SessionManager     PermissionService     SkillRegistry                      │
│  McpHub     EnvironmentService     metadataProviders[]                       │
│  agentBridgeFactory: () => Promise<IAgentBridge | null>                      │
│  toolRegistryFactory: (params) => Promise<Map<EAgentToolCallNames, ITool>>   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  Session context  (SessionManager.sessions[id])                       │    │
│  │  ──────────────────────────────────────────────────────────────────   │    │
│  │  id, cwd, history[], modes?, permissions, tools                       │    │
│  │  bridge: IAgentBridge | null                                          │    │
│  │  pendingPrompt: AbortController | null                                │    │
│  │  contextId?, taskId?, taskStatus?     pendingToolCall?                │    │
│  │                                                                       │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │    │
│  │  │  Turn context  (ephemeral, в handle-prompt/regenerate)           │ │    │
│  │  │  ──────────────────────────────────────────────────────────────  │ │    │
│  │  │  id, sessionId, status: TTurnStatus                              │ │    │
│  │  │  contextId?, taskId?     pendingToolResults[] (за раунд)         │ │    │
│  │  │  deps: EventBus + CommandRunner                                  │ │    │
│  │  └─────────────────────────────────────────────────────────────────┘ │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Команды и кто их вызывает

```
                          ┌─────────────────────────────┐
   ACP RPC ──► NessyAgent ┤  prompt / loadSession /     │
                          │  newSession / setMode / ... │
                          └─────────────┬───────────────┘
                                        │ commandRunner.run(...)
                                        ▼
                  ┌──────────────────────────────────────────┐
                  │  use-case commands                       │
                  ├──────────────────────────────────────────┤
                  │  handlePromptCommand          ──► Turn   │
                  │  regenerateAgentTurnCommand   ──► Turn   │
                  │  createSessionCommand                    │
                  │  loadSessionCommand                      │
                  │  listSessionsCommand                     │
                  │  setSessionModeCommand                   │
                  │  listSkillsCommand                       │
                  │  mcpListCommand / mcpUpdateCommand /     │
                  │  setupDefaultMcpCommand                  │
                  └──────────────────────────────────────────┘
                                        │ Turn.commandRunner.run(...)
                                        ▼
                  ┌──────────────────────────────────────────┐
                  │  внутренние команды (turn lifecycle)     │
                  ├──────────────────────────────────────────┤
                  │  forwardToAgentCommand                   │ ── owns streamWithRetry + RetryManager
                  │  handleA2aErrorCommand                   │ ── classify + retry decision
                  │  toolCallCommand                         │ ── permission + exec + events
                  └──────────────────────────────────────────┘
                                        │
                                        ▼
                  ┌──────────────────────────────────────────┐
                  │  адаптеры                                │
                  ├──────────────────────────────────────────┤
                  │  A2ABridge: sendInitial / sendContinuation│
                  │             cancelTask / getModes        │
                  │  McpClient (через McpHub)                │
                  │  Локальные tool-инструменты              │
                  └──────────────────────────────────────────┘
```

### Поток одного prompt'а (sequence)

```
User
  │ (ACP prompt RPC)
  ▼
NessyAgent.prompt
  │
  └──► CommandRunner.run(handlePromptCommand, { sessionId, promptContent, ... })
         │
         │  1) sessionManager.recordUserMessage(...)
         │  2) signal = sessionManager.startPrompt(sessionId)
         │  3) collectSessionMetadata(deps, session)
         │  4) buildInitialParts(...)  →  initialParts: TDomainPart[]
         │  5) turn = new Turn(uuid, sessionId, eventBus, this)
         │  6) await turn.start({ initialParts, modeId, metadata }, signal)
         │
         │      ┌──────────────────────────────────────────────────────────┐
         │      │ Turn.start  (loop, пока есть pendingToolResults)         │
         │      │   transition: forwarding → streaming                     │
         │      │                                                          │
         │      │   stream = await runner.run(forwardToAgentCommand, {     │
         │      │       sessionId, parts, contextId, modeId, metadata,     │
         │      │       isContinuation, signal })                          │
         │      │                                                          │
         │      │       ┌────────────────────────────────────────────────┐ │
         │      │       │ streamWithRetry (gen.)                         │ │
         │      │       │   retryManager = new A2ARetryManager()         │ │
         │      │       │   loop:                                        │ │
         │      │       │     try yield* bridge.sendInitial(args)        │ │
         │      │       │     catch err:                                 │ │
         │      │       │       runner.run(handleA2aErrorCommand,        │ │
         │      │       │         { err, signal, retryManager })         │ │
         │      │       │         ─ возврат: ретрай                      │ │
         │      │       │         ─ throw TurnRetryableError/Persistent  │ │
         │      │       └────────────────────────────────────────────────┘ │
         │      │                                                          │
         │      │   for await event of stream:                             │
         │      │     onStreamEvent(event):                                │
         │      │       context     → eventBus.emit(sessionUpdate)         │
         │      │       agent_text  → eventBus.emit(message)               │
         │      │       data_chunk  → eventBus.emit(message)               │
         │      │       tool_call   → runner.run(toolCallCommand, ...)     │
         │      │                       ↳ permission + exec + events      │
         │      │                       ↳ push pendingToolResults          │
         │      │       task_status → eventBus.emit(sessionUpdate)         │
         │      │                     if input-required+shouldSuspend →   │
         │      │                       suspend                            │
         │      │                                                          │
         │      │   round end:                                             │
         │      │     pendingToolResults empty → finalize 'completed'      │
         │      │     else → next round with tool_result parts             │
         │      │                                                          │
         │      │   error from consume:                                    │
         │      │     TurnRetryableError → finalize 'failed_retryable'     │
         │      │     TurnPersistentError → backendRejection retry once    │
         │      │                           else finalize 'failed'         │
         │      └──────────────────────────────────────────────────────────┘
         │
         │  7) sessionManager.finishPrompt(sessionId)
         │
         ▼
  return stopReason  (end_turn | cancelled)
```

### События на шине

| Событие             | Эмитирует                        | Слушают                             |
| ------------------- | -------------------------------- | ----------------------------------- |
| `sessionUpdate`     | Turn (context/task_status)       | SessionManager.applyUpdate          |
| `sessionCreated`    | SessionManager                   | PermissionService.loadDefault       |
| `sessionLoaded`     | SessionManager                   | PermissionService.loadDefault       |
| `message`           | Turn (agent_text/data_chunk/err) | NessyAgent.handlePrompt, SessionMgr |
| `toolCallStarted`   | toolCallCommand                  | NessyAgent.handleToolCallStarted    |
| `toolCallCompleted` | toolCallCommand                  | NessyAgent + history register       |
| `toolCallFailed`    | toolCallCommand / Turn           | NessyAgent + history register       |
| `modeChanged`       | SessionManager.setMode           | NessyAgent.handleModeChanged        |
| `turnStarted`       | Turn.start                       | (зарезервировано для UI/телеметрии) |
| `turnStatusChanged` | Turn.transition                  | (зарезервировано)                   |
| `turnEnded`         | Turn.finalize                    | (зарезервировано)                   |
| `cancelPrompt`      | NessyAgent.cancel                | index.ts → bridge.cancelTask        |
| `environmentUpdate` | NessyAgent.initialize            | EnvironmentService                  |

### Карта типов и ошибок

| Тип / класс              | Где определён                      | Назначение                                                                                            |
| ------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `TDomainPart`            | `core/turn-types.ts`               | Часть, отправляемая транспорту (text/tool_result/retry_marker)                                        |
| `TStreamEvent`           | `core/turn-types.ts`               | Доменное событие из стрима (context/task_status/agent_text/tool_call/data_chunk)                      |
| `TTransportSendArgs`     | `core/turn-types.ts`               | Аргументы транспорта (parts + контекст + signal)                                                      |
| `TTurnStatus`            | `core/turn-types.ts`               | Статусы автомата Turn                                                                                 |
| `TTurnStartArgs/Outcome` | `core/turn-types.ts`               | Вход/выход `turn.start`                                                                               |
| `TurnRetryableError`     | `core/turn-types.ts`               | Терминальная ретраябл (показать пользователю + дать regenerate)                                       |
| `TurnPersistentError`    | `core/turn-types.ts`               | Терминальная непоправимая                                                                             |
| `RetryableError`         | `adapter/a2a/a2a-errors.ts`        | **Внутренний** транспортный сигнал (стрим-ошибка из DataPart) — не пересекает границу команд напрямую |
| `A2ARetryManager`        | `adapter/a2a/a2a-retry-manager.ts` | Stateful счётчик ретраев (живёт одну стрим-сессию в `forwardToAgentCommand`)                          |

## Журнал сессии

Опционально (можно отдельным шагом): добавить записи `turn_started` / `turn_ended` в `TSessionRecord`. Это упростит `regenerateAgentTurnCommand` (последний turn становится явным якорем вместо поиска по `findPromptBeforeLastRetryableError`). Связывается с пунктом 10 рефактор-листа (versioned journal): если делать миграцию, имеет смысл сделать заодно.

## Статус миграции

Все шаги выполнены в production-коде (тесты ещё не обновлены):

1. ✅ Домейн-типы (`core/turn-types.ts`).
2. ✅ `A2ABridge` переведён на `sendInitial`/`sendContinuation` (`openStream` маппит wire → `TStreamEvent`).
3. ✅ `forwardToAgentCommand` создан, владеет `streamWithRetry` и `A2ARetryManager`.
4. ✅ Класс `Turn` реализован (`core/turn.ts`) с happy-path.
5. ✅ Tool-loop, `outgoingResults`, `backendRejection` перенесены в `Turn`.
6. ✅ Suspend-for-input живёт в `Turn` через `shouldSuspend(hasVisibleMessage)`.
7. ✅ `TurnRetryableError` / `TurnPersistentError`. Классификация вынесена в `handleA2aErrorCommand`. `AgentError`-обвязка из `handlePrompt` / `regenerateAgentTurn` удалена.
8. ✅ `handlePromptCommand` переключён на `Turn`.
9. ✅ `regenerateAgentTurnCommand` переключён на `Turn`.
10. ✅ Старый `A2ABridge.forward` (и приватные `sendWithRetry`, `sendPartsAsChunks`, `reportPendingToolFailures`) удалены.
11. ✅ `IAgentBridge` обновлён: `sendInitial` / `sendContinuation` / `cancelTask` / `getModes`. `TForwardOptions` удалён.

Бонусом сделано:

- `ICommand.execute(this: CommandRunner, payload)`: команды читают зависимости через `this.deps`, диспетчат под-команды через `this.run(...)`. `commandRunner` в `TCommandDeps` не нужен.
- `getModes()` в `IAgentBridge` инкапсулирует чтение `AgentCard` (вместо публичного `client: Client`).

## Что НЕ изменилось

- ACP-адаптер (`NessyAgent`) — публичный интерфейс к IDE остаётся прежним.
- Шина событий — те же события для tool calls и сообщений, плюс три новых для Turn (`turnStarted` / `turnStatusChanged` / `turnEnded`), которые ACP-адаптер пока игнорирует.
- `PermissionService`, `ToolRegistry`, `McpHub`, `SkillRegistry` — без изменений.
- `SessionManager` — без расширения API: Turn остался эфемерным внутри команды, методы `attachTurn` / `detachTurn` / поле `currentTurn` НЕ добавлялись. Очистка `SessionManager` от business-logic — отдельная работа (пункт 4 рефактор-листа).
- Журнал — без миграции (`turn_started` / `turn_ended` записи НЕ добавлены, см. ниже).

## Открытые вопросы

1. **`currentTurn` на сессии vs. ephemeral.** Решено: Turn остался эфемерным (живёт только внутри команды). Отмена идёт через `session.pendingPrompt.signal`, видимый турн снаружи пока не нужен. Если появится требование "cancel current turn" с UI или телеметрия по turn'ам — добавить поле в `ISessionState`.
2. **Сериализация Turn'а.** Не делаем. Прерванный turn теряется, как и раньше (поведение `pendingPrompt`).
3. **`mode_change` посреди turn'а.** Сейчас мода меняется только через `setSessionMode` (отдельный ACP-запрос). Если удалённый агент начнёт инициировать смену моды стримом — добавить `mode_change` в `TStreamEvent`.
4. **Турн с несколькими `taskId`.** Сейчас допустимо: Turn хранит последний полученный `taskId`. Если потребуется отслеживать историю task'ов — расширить до массива.
5. **Универсализация транспорта.** `handleA2aErrorCommand` и `streamWithRetry` сейчас явно A2A-специфичны. При появлении второго транспорта (например, локальный мост) понадобится либо аналог `handleXxxErrorCommand`, либо вынос политики ретраев за `IAgentBridge` (метод `classifyError` / `shouldRetry`).
6. **Тесты.** Production-код типизируется чисто, но `__tests__/*` ссылаются на удалённые `bridge.forward` / `TForwardOptions` / `bridge.client` — требуют апдейта (отдельная работа).
