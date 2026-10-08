import {
    AgentSideConnection,
    PROTOCOL_VERSION,
    type Agent,
    type InitializeRequest,
    type InitializeResponse,
    type AuthenticateRequest,
    type AuthenticateResponse,
    type NewSessionRequest,
    type NewSessionResponse,
    type LoadSessionRequest,
    type LoadSessionResponse,
    type ListSessionsRequest,
    type ListSessionsResponse,
    type CloseSessionRequest,
    type CloseSessionResponse,
    type PromptRequest,
    type PromptResponse,
    type CancelNotification,
    type SetSessionModeRequest,
    type SetSessionModeResponse,
    type Stream,
} from '@agentclientprotocol/sdk';
import { log } from '../../utils/log.js';
import type {
    TClientCapabilities,
    TPermissionDecision,
    IToolCall,
    TToolCallPresentation,
    IPermissionOption,
    IPermissionOutcome,
} from '../../types.js';
import { AnalyticsRequestDetailsSchema } from '../../metadata/analytics-request-details/schema.js';
import type {
    ISessionState,
    TSessionHistoryEntry,
    TSessionHistoryToolCall,
    TSessionPromptContentBlock,
    TSessionResourceLink,
} from '../../types.js';
import type { TPermissionResolveMethod } from '../../core/permission/types.js';
import type { CommandRunner } from '../../core/command-runner.js';
import type { EventBus } from '../../core/event-bus.js';
import {
    environmentUpdate,
    analyticsRequestDetailsUpdate,
    cancelPrompt,
    type TMessageEvent,
    type TThinkingEvent,
    type TToolCallStartedEvent,
    type TToolCallCompletedEvent,
    type TToolCallFailedEvent,
    type TModeChangedEvent,
    type TSkillsRefreshedEvent,
} from '../../core/events.js';
import { handlePromptCommand } from '../../commands/handle-prompt.command.js';
import { createSessionCommand } from '../../commands/create-session.command.js';
import { loadSessionCommand } from '../../commands/load-session.command.js';
import { listSessionsCommand } from '../../commands/list-sessions.command.js';
import { closeSessionCommand } from '../../commands/close-session.command.js';
import { setSessionModeCommand } from '../../commands/set-session-mode.command.js';
import { toAcpAvailableCommands, toAcpResultContent, toAcpToolCallContent } from './acp-mappers.js';
import { type IACPAdapter, type IPermissionAdapter } from './types.js';
import { createDefaultAcpToolCallMapper, type IAcpToolCallMapper } from './tool-call-mapper.js';
import type { TAcpRuntimeConfig } from './runtime-config.js';
import { createDefaultAcpExtMethodHandlers } from './ext-methods/defaults.js';
import { AcpExtMethodRegistry } from './ext-methods/registry.js';
import type { IAcpExtMethodHandler } from './ext-methods/types.js';
import { RESOURCE_LINK_BLOCK_TYPE, toResourceLinkPayload } from '../../utils/resource-link.js';
import { abortable } from '../../utils/abortable.js';
import { onlyDefinedFields } from '../../utils/onlyDefinedFields.js';

const DEFAULT_CAPABILITIES: TClientCapabilities = {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
    tools: {},
};

const AGENT_MESSAGE_ERROR_META_KEY = 'nessy/error';

export class NessyAgent implements Agent, IACPAdapter, IPermissionAdapter {
    private _connection: AgentSideConnection;
    private source = 'nessyAcp';
    private extMethods: AcpExtMethodRegistry;
    readonly capabilities: TClientCapabilities = {
        ...DEFAULT_CAPABILITIES,
        fs: { ...DEFAULT_CAPABILITIES.fs },
        tools: {},
    };
    private permissionResolveMethod: TPermissionResolveMethod | undefined;

    constructor(
        connectionFactory: (instance: NessyAgent) => AgentSideConnection,
        private commandRunner: CommandRunner,
        private eventBus: EventBus,
        private toolCallMapper: IAcpToolCallMapper = createDefaultAcpToolCallMapper(),
        private runtimeConfig: TAcpRuntimeConfig = {},
        extMethodHandlers?: IAcpExtMethodHandler[],
    ) {
        this.extMethods = new AcpExtMethodRegistry(
            extMethodHandlers ?? createDefaultAcpExtMethodHandlers(commandRunner, this.source),
        );
        this._connection = connectionFactory(this);
    }

    get connection(): AgentSideConnection {
        return this._connection;
    }

    async initialize(params: InitializeRequest): Promise<InitializeResponse> {
        log('Initialize request received');

        const clientCapabilities = params.clientCapabilities;
        if (clientCapabilities?.fs) {
            this.capabilities.fs.readTextFile = clientCapabilities.fs.readTextFile ?? false;
            this.capabilities.fs.writeTextFile = clientCapabilities.fs.writeTextFile ?? false;
        }
        if (clientCapabilities?.terminal !== undefined) {
            this.capabilities.terminal = clientCapabilities.terminal ?? false;
        }
        const meta = clientCapabilities?._meta as Record<string, unknown> | undefined;

        const metaTools = meta?.tools;
        if (metaTools && typeof metaTools === 'object') {
            for (const [name, value] of Object.entries(metaTools as Record<string, unknown>)) {
                if (value === true) {
                    this.capabilities.tools[name] = true;
                }
            }
        }

        const metaEnv = meta?.environment as Record<string, unknown> | undefined;
        if (metaEnv && typeof metaEnv === 'object') {
            const override: Record<string, string> = {};
            if (typeof metaEnv.os === 'string') override.platform = metaEnv.os;
            if (typeof metaEnv.platform === 'string') override.platform = metaEnv.platform;
            if (typeof metaEnv.shell === 'string') override.shell = metaEnv.shell;
            if (typeof metaEnv.editor === 'string') override.editor = metaEnv.editor;
            if (Object.keys(override).length > 0) {
                this.eventBus.emit(environmentUpdate, override);
            }
        }

        const analyticsParse = AnalyticsRequestDetailsSchema.safeParse(
            meta?.analytics_request_details,
        );
        if (analyticsParse.success) {
            const override = onlyDefinedFields(analyticsParse.data);
            if (Object.keys(override).length > 0) {
                this.eventBus.emit(analyticsRequestDetailsUpdate, override);
            }
        } else if (meta?.analytics_request_details !== undefined) {
            log(
                `Ignoring invalid _meta.analytics_request_details: ${analyticsParse.error.message}`,
            );
        }

        const metaResolveMethod = meta?.permissionResolveMethod;
        if (
            metaResolveMethod === 'extended' ||
            this.runtimeConfig.permissionResolveMethod === 'extended'
        ) {
            this.permissionResolveMethod = 'extended';
        } else {
            this.permissionResolveMethod = undefined;
        }
        if (metaResolveMethod !== undefined && metaResolveMethod !== 'extended') {
            log(
                `Unknown permissionResolveMethod ${JSON.stringify(metaResolveMethod)} — ignoring client value`,
            );
        }

        log(`Client capabilities: ${JSON.stringify(this.capabilities)}`);

        return {
            protocolVersion: PROTOCOL_VERSION,
            agentCapabilities: {
                loadSession: true,
                sessionCapabilities: {
                    close: {},
                    list: {},
                },
            },
            _meta: { permissionResolveMethod: 'extended' },
        };
    }

    async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse | void> {
        return {};
    }

    async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
        const session = await this.commandRunner.run(createSessionCommand, {
            cwd: params.cwd,
            mcpServers: params.mcpServers,
            permissionResolveMethod: this.permissionResolveMethod,
        });
        const response: NewSessionResponse = { sessionId: session.id };

        if (session.modes) {
            response.modes = toAcpModes(session);
        }

        return response;
    }

    async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
        const session = await this.commandRunner.run(loadSessionCommand, {
            sessionId: params.sessionId,
            cwd: params.cwd,
            mcpServers: params.mcpServers,
        });

        for (const entry of session.history) {
            await this.replayHistoryEntry(session.id, entry);
        }

        const response: LoadSessionResponse = {};
        if (session.modes) {
            response.modes = toAcpModes(session);
        }

        return response;
    }

    async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
        const result = await this.commandRunner.run(listSessionsCommand, {
            cwd: params.cwd,
            cursor: params.cursor,
        });

        return {
            nextCursor: result.nextCursor,
            sessions: result.sessions.map((session) => ({
                sessionId: session.sessionId,
                cwd: session.cwd,
                title: session.title,
                updatedAt: session.updatedAt,
            })),
        };
    }

    async unstable_closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
        await this.commandRunner.run(closeSessionCommand, {
            sessionId: params.sessionId,
        });
        return {};
    }

    async prompt(params: PromptRequest): Promise<PromptResponse> {
        const userMessageId = params.messageId ?? crypto.randomUUID();
        const promptContent = extractPromptContent(params.prompt);

        const stopReason = await this.commandRunner.run(handlePromptCommand, {
            sessionId: params.sessionId,
            promptContent,
            userMessageId,
            source: this.source,
        });

        return {
            stopReason,
            userMessageId,
        } as PromptResponse;
    }

    async cancel(params: CancelNotification): Promise<void> {
        this.eventBus.emit(cancelPrompt, params.sessionId);
    }

    async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
        await this.commandRunner.run(setSessionModeCommand, {
            sessionId: params.sessionId,
            modeId: params.modeId,
        });
        return {};
    }

    async extMethod(
        method: string,
        params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const result = await this.extMethods.handle(method, params);
        return result ?? { error: `Unsupported extension method: ${method}` };
    }

    handlePrompt({ sessionId, text, source, messageId, error }: TMessageEvent) {
        if (source === this.source) return;
        void this._connection.sessionUpdate({
            sessionId,
            update: {
                sessionUpdate: 'agent_message_chunk',
                content: {
                    type: 'text',
                    text,
                    ...(error ? { _meta: { [AGENT_MESSAGE_ERROR_META_KEY]: error } } : {}),
                },
                messageId: messageId ?? crypto.randomUUID(),
            },
        });
    }

    handleThinking({ sessionId, text, source, messageId }: TThinkingEvent) {
        if (source === this.source) return;
        void this._connection.sessionUpdate({
            sessionId,
            update: {
                sessionUpdate: 'agent_thought_chunk',
                content: {
                    type: 'text',
                    text,
                },
                messageId: messageId ?? crypto.randomUUID(),
            },
        });
    }

    private async replayHistoryEntry(
        sessionId: string,
        entry: TSessionHistoryEntry,
    ): Promise<void> {
        if (entry.kind === 'tool_call') {
            await this.replayToolCallEntry(sessionId, entry);
            return;
        }
        if (entry.kind === 'thought') {
            await this._connection.sessionUpdate({
                sessionId,
                update: {
                    sessionUpdate: 'agent_thought_chunk',
                    content: { type: 'text', text: entry.text },
                    messageId: entry.messageId,
                },
            });
            return;
        }
        for (const block of toAcpHistoryContent(entry)) {
            const content =
                entry.role === 'agent' && entry.error && block.type === 'text'
                    ? { ...block, _meta: { [AGENT_MESSAGE_ERROR_META_KEY]: entry.error } }
                    : block;
            await this._connection.sessionUpdate({
                sessionId,
                update: {
                    sessionUpdate:
                        entry.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',
                    content,
                    messageId: entry.messageId,
                },
            });
        }
    }

    private async replayToolCallEntry(
        sessionId: string,
        entry: TSessionHistoryToolCall,
    ): Promise<void> {
        const presentation = entry.presentation;
        const status = entry.status;

        await this._connection.sessionUpdate({
            sessionId,
            update: {
                ...this.toolCallMapper.toToolCall(
                    {
                        id: entry.toolCallId,
                        name: entry.name,
                        arguments: JSON.stringify(presentation.rawInput),
                    } as IToolCall,
                    presentation,
                    'pending',
                ),
                sessionUpdate: 'tool_call',
            },
        });

        const finalContent =
            status === 'completed' && entry.result !== undefined
                ? toAcpResultContent(presentation, entry.result)
                : status === 'failed' && entry.error !== undefined
                  ? [
                        ...toAcpToolCallContent(presentation.content),
                        { type: 'content', content: { type: 'text', text: entry.error } },
                    ]
                  : toAcpToolCallContent(presentation.content);

        await this._connection.sessionUpdate({
            sessionId,
            update: {
                ...this.toolCallMapper.toToolCallUpdate(
                    {
                        id: entry.toolCallId,
                        name: entry.name,
                        arguments: JSON.stringify(presentation.rawInput),
                    } as IToolCall,
                    presentation,
                ),
                sessionUpdate: 'tool_call_update',
                status,
                content: finalContent,
                ...(status === 'completed' && entry.result !== undefined
                    ? { rawOutput: entry.result }
                    : {}),
                ...(status === 'failed' && entry.error !== undefined
                    ? { rawOutput: entry.error }
                    : {}),
            },
        });
    }

    handleToolCallStarted({ sessionId, toolCall, presentation }: TToolCallStartedEvent) {
        void this._connection.sessionUpdate({
            sessionId,
            update: {
                ...this.toolCallMapper.toToolCall(toolCall, presentation, 'in_progress'),
                sessionUpdate: 'tool_call',
            },
        });
    }

    handleToolCallCompleted({
        sessionId,
        toolCall,
        presentation,
        result,
    }: TToolCallCompletedEvent) {
        void this._connection.sessionUpdate({
            sessionId,
            update: {
                ...this.toolCallMapper.toToolCallUpdate(toolCall, presentation),
                sessionUpdate: 'tool_call_update',
                status: 'completed',
                rawOutput: result,
                content: toAcpResultContent(presentation, result),
            },
        });
    }

    handleToolCallFailed({ sessionId, toolCall, presentation, error }: TToolCallFailedEvent) {
        void this._connection.sessionUpdate({
            sessionId,
            update: {
                ...this.toolCallMapper.toToolCallUpdate(toolCall, presentation),
                sessionUpdate: 'tool_call_update',
                status: 'failed',
                rawOutput: error,
                content: [
                    ...toAcpToolCallContent(presentation.content),
                    { type: 'content', content: { type: 'text', text: error } },
                ],
            },
        });
    }

    handleSkillsRefreshed({ sessionId, skills }: TSkillsRefreshedEvent) {
        void this._connection.sessionUpdate({
            sessionId,
            update: {
                sessionUpdate: 'available_commands_update',
                availableCommands: toAcpAvailableCommands(skills),
            },
        });
    }

    handleModeChanged({ sessionId, modeId }: TModeChangedEvent) {
        void this._connection.sessionUpdate({
            sessionId,
            update: {
                sessionUpdate: 'current_mode_update',
                currentModeId: modeId,
            },
        });
    }

    async requestPermission(
        sessionId: string,
        toolCall: IToolCall,
        presentation: TToolCallPresentation | undefined,
        signal: AbortSignal | undefined,
        permissionOptions?: IPermissionOption[],
    ): Promise<TPermissionDecision | IPermissionOutcome | null> {
        log(`Requesting permission for [${toolCall.name}](session = ${sessionId})`);

        // Use provided options (extended mode) or default 4 options (legacy mode).
        // The ACP wire schema only allows "reject_once" (not "deny_once"), so
        // translate at the boundary; the inbound path does the reverse.
        const options: Array<{ optionId: string; name: string; kind: string }> = permissionOptions
            ? permissionOptions.map((o) => ({
                  optionId: o.optionId,
                  name: o.name,
                  kind: o.kind === 'deny_once' ? 'reject_once' : o.kind,
              }))
            : [
                  { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
                  { optionId: 'allow_always', name: 'Allow always', kind: 'allow_always' },
                  { optionId: 'reject_once', name: 'Reject once', kind: 'reject_once' },
                  { optionId: 'reject_always', name: 'Reject always', kind: 'reject_always' },
              ];

        const requestPermissionPromise = this._connection.requestPermission({
            sessionId,
            toolCall: this.toolCallMapper.toToolCallUpdate(toolCall, presentation),
            options,
        });

        try {
            const response = signal
                ? await abortable(requestPermissionPromise, signal)
                : await requestPermissionPromise;

            if (response.outcome.outcome === 'cancelled') {
                log(`Permission cancelled for [${toolCall.name}]`);
                return null;
            }

            // Extended mode: return IPermissionOutcome with optionId
            if (permissionOptions) {
                const outcome: IPermissionOutcome = { optionId: response.outcome.optionId };
                log(`Permission outcome for [${toolCall.name}]: ${outcome.optionId}`);
                return outcome;
            }

            // Legacy mode: return TPermissionDecision
            const decision = response.outcome.optionId as TPermissionDecision;
            log(`Permission decision for [${toolCall.name}]: ${decision}`);
            return decision;
        } catch (err) {
            if (signal?.aborted) {
                log(`Permission request aborted for [${toolCall.name}]`);
                return null;
            }
            throw err;
        }
    }
}

function extractPromptContent(prompt: PromptRequest['prompt']): TSessionPromptContentBlock[] {
    return prompt.flatMap((block): TSessionPromptContentBlock[] => {
        if (block.type === 'text') {
            return [{ type: 'text', text: block.text }];
        }

        if (block.type !== RESOURCE_LINK_BLOCK_TYPE) {
            log(`Dropping unsupported ACP content block: ${block.type}`);
            return [];
        }

        if (!block.uri || !block.name) {
            log(`Dropping resource_link with empty uri/name: ${JSON.stringify(block)}`);
            return [];
        }

        return [
            {
                type: RESOURCE_LINK_BLOCK_TYPE,
                ...toResourceLinkPayload({
                    uri: block.uri,
                    name: block.name,
                    title: block.title ?? undefined,
                    description: block.description ?? undefined,
                    mimeType: block.mimeType ?? undefined,
                    size: block.size ?? undefined,
                }),
            },
        ];
    });
}

function toAcpHistoryContent(
    entry: Extract<TSessionHistoryEntry, { kind: 'message' }>,
): PromptRequest['prompt'] {
    const content =
        entry.content ??
        (entry.text.length > 0
            ? ([{ type: 'text', text: entry.text }] satisfies TSessionPromptContentBlock[])
            : []);

    return content
        .filter((block) => block.type !== 'metadata')
        .map((block) => {
            if (block.type === 'text') {
                return { type: 'text', text: block.text };
            }
            return toAcpResourceLink(block);
        });
}

function toAcpResourceLink(resource: TSessionResourceLink) {
    const displayName = resourceLinkDisplayName(resource);
    return {
        type: RESOURCE_LINK_BLOCK_TYPE,
        ...toResourceLinkPayload(resource),
        ...(!resource.title && displayName !== resource.name ? { title: displayName } : {}),
    } as const;
}

function resourceLinkDisplayName(resource: TSessionResourceLink): string {
    const name = resource.name.trim();
    const leaf = lastPathSegment(name);
    return leaf || name || resource.uri;
}

function lastPathSegment(value: string): string | undefined {
    return value
        .split(/[\\/]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .at(-1);
}

export function acpConnectionFactory(stream: Stream) {
    return (instance: NessyAgent) =>
        new AgentSideConnection(() => {
            return instance;
        }, stream);
}

function toAcpModes(session: ISessionState) {
    if (!session.modes) return undefined;
    return {
        availableModes: session.modes.availableModes.map((m) => ({
            id: m.id,
            name: m.name,
            ...(m.description !== undefined ? { description: m.description } : {}),
        })),
        currentModeId: session.modes.currentModeId,
    };
}
