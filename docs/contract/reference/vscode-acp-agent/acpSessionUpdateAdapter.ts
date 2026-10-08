import {
    ContentBlock,
    SessionNotification,
    ToolCall,
    ToolCallContent,
    ToolCallStatus,
    ToolCallUpdate,
} from '@agentclientprotocol/sdk';

import { A2AMessageTypes, Author } from '../../shared-webviews/src';
import { A2AToolEventBus, A2AToolEvents } from '../a2aAgent/toolHandlers';
import { A2AEventBus, A2AEvents } from '../a2aAgent/types';
import { getRateLimitRetryMessage } from '../agentMode/rateLimitRetryMessage';

const AGENT_MESSAGE_ERROR_META_KEY = 'nessy/error';
const RATE_LIMIT_RETRY_META_KEY = 'nessy/rate-limit-retry';

const FALLBACK_MESSAGE_ID = 'acp-agent-message';
const FALLBACK_THOUGHT_ID = 'acp-agent-thought';

export interface AcpTurnErrorMeta {
    message: string;
    retryable?: boolean;
    code?: number;
    requestId?: string;
}

export interface AcpSessionUpdateAdapterLogger {
    debug(message: string): void;
}

interface ToolCallBuffer {
    title: string;
    rawInput: unknown;
    content: ToolCallContent[];
    rawOutput: unknown;
    status: ToolCallStatus;
}

interface AcpRateLimitRetryMeta {
    attempt: number;
    maxRetries: number;
    delayMs: number;
}

export type AcpAssistantSnapshot =
    | { kind: 'message'; id: string; text: string }
    | { kind: 'reasoning'; id: string; text: string };

function extractText(content: ContentBlock): string {
    return content.type === 'text' ? content.text : '';
}

function extractErrorMeta(content: ContentBlock, message: string): AcpTurnErrorMeta | undefined {
    const raw = content._meta?.[AGENT_MESSAGE_ERROR_META_KEY];

    if (raw === undefined || raw === null || typeof raw !== 'object') {
        return undefined;
    }

    const meta = raw as Record<string, unknown>;

    return {
        message,
        retryable: meta.retryable === true,
        code: typeof meta.code === 'number' ? meta.code : undefined,
        requestId: typeof meta.requestId === 'string' ? meta.requestId : undefined,
    };
}

function extractRateLimitRetryMeta(
    meta: Record<string, unknown> | null | undefined,
): AcpRateLimitRetryMeta | undefined {
    const raw = meta?.[RATE_LIMIT_RETRY_META_KEY];

    if (raw === undefined || raw === null || typeof raw !== 'object') {
        return undefined;
    }

    const retry = raw as Record<string, unknown>;
    if (
        typeof retry.attempt !== 'number' ||
        typeof retry.maxRetries !== 'number' ||
        typeof retry.delayMs !== 'number'
    ) {
        return undefined;
    }

    return {
        attempt: retry.attempt,
        maxRetries: retry.maxRetries,
        delayMs: retry.delayMs,
    };
}

function stringifyUnknown(value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value, undefined, 2);
    } catch {
        return String(value);
    }
}

function extractToolContent(content: ToolCallContent): string {
    switch (content.type) {
        case 'content': {
            if (content.content.type === 'text') {
                return content.content.text;
            }

            return stringifyUnknown(content.content);
        }
        case 'diff': {
            const parts = [`Diff: ${content.path}`];

            if (content.oldText !== undefined && content.oldText !== null) {
                parts.push('--- old', content.oldText);
            }

            parts.push('+++ new', content.newText);

            return parts.join('\n');
        }
        case 'terminal': {
            return `Terminal: ${content.terminalId}`;
        }
    }
}

function buildToolOutput(buffer: ToolCallBuffer): string {
    const outputParts = [
        { value: stringifyUnknown(buffer.rawOutput), deduplicate: true },
        ...buffer.content.map((content) => ({
            value: extractToolContent(content),
            deduplicate: content.type === 'content',
        })),
    ].filter(({ value }) => value.trim().length > 0);

    const deduplicatedParts = outputParts.filter((candidate, candidateIndex) => {
        if (!candidate.deduplicate) {
            return true;
        }

        const normalizedCandidate = candidate.value.trim();

        return !outputParts.some((other, otherIndex) => {
            if (!other.deduplicate || otherIndex === candidateIndex) {
                return false;
            }

            const normalizedOther = other.value.trim();
            const otherWins =
                normalizedOther.length > normalizedCandidate.length ||
                (normalizedOther.length === normalizedCandidate.length &&
                    otherIndex < candidateIndex);

            return otherWins && normalizedOther.includes(normalizedCandidate);
        });
    });

    return deduplicatedParts.map(({ value }) => value).join('\n\n');
}

function toWebviewStatus(status: ToolCallStatus): 'success' | 'error' | 'in-progress' {
    return status === 'failed' ? 'error' : status === 'completed' ? 'success' : 'in-progress';
}

/**
 * Translates ACP `session/update` notifications into `A2AEventBus` render events.
 * ACP streams incremental deltas, so text/thought chunks are accumulated by
 * `messageId` and emitted as the full snapshot the renderer expects.
 */
export class AcpSessionUpdateAdapter {
    private readonly messageBuffers = new Map<string, string>();
    private readonly reasoningBuffers = new Map<string, string>();
    private readonly toolCallBuffers = new Map<string, ToolCallBuffer>();
    private readonly canceledToolCallIds = new Set<string>();
    private readonly assistantSnapshotOrder: Array<Pick<AcpAssistantSnapshot, 'kind' | 'id'>> = [];
    private readonly replayMessageOrder: string[] = [];
    private readonly replayMessageIds = new Set<string>();
    private fallbackIdGeneration = 0;

    constructor(
        private readonly eventBus: A2AEventBus,
        private readonly toolEventBus: A2AToolEventBus,
        private readonly logger: AcpSessionUpdateAdapterLogger,
        private readonly onTurnError: (error: AcpTurnErrorMeta) => void,
    ) {}

    handle(notification: SessionNotification): void {
        const update = notification.update;

        if (
            (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') &&
            this.canceledToolCallIds.has(update.toolCallId)
        ) {
            if (
                update.sessionUpdate === 'tool_call' &&
                (update.status === 'pending' || update.status === 'in_progress')
            ) {
                this.canceledToolCallIds.delete(update.toolCallId);
            } else {
                return;
            }
        }

        switch (update.sessionUpdate) {
            case 'user_message_chunk': {
                this.rememberReplayMessage(update.messageId);
                this.logger.debug(
                    'acp-agent: tracked replayed user message order without rendering duplicate content',
                );
                break;
            }
            case 'agent_message_chunk': {
                const text = extractText(update.content);
                const id = update.messageId ?? this.fallbackId(FALLBACK_MESSAGE_ID);
                this.rememberReplayMessage(id);
                const errorMeta = extractErrorMeta(update.content, text);

                if (errorMeta !== undefined) {
                    this.onTurnError(errorMeta);
                    return;
                }

                if (!this.messageBuffers.has(id)) {
                    this.assistantSnapshotOrder.push({ kind: 'message', id });
                }
                const accumulated = (this.messageBuffers.get(id) ?? '') + text;
                this.messageBuffers.set(id, accumulated);

                this.eventBus.emit(A2AEvents.ShowTextMessage, id, Author.Assistant, accumulated);
                break;
            }
            case 'agent_thought_chunk': {
                const text = extractText(update.content);
                const id =
                    update.messageId !== undefined && update.messageId !== null
                        ? `${update.messageId}_reasoning`
                        : this.fallbackId(FALLBACK_THOUGHT_ID);
                this.rememberReplayMessage(id);
                if (!this.reasoningBuffers.has(id)) {
                    this.assistantSnapshotOrder.push({ kind: 'reasoning', id });
                }
                const accumulated = (this.reasoningBuffers.get(id) ?? '') + text;
                this.reasoningBuffers.set(id, accumulated);

                this.eventBus.emit(A2AEvents.ShowReasoningMessage, id, accumulated);
                break;
            }
            case 'tool_call': {
                this.rememberReplayMessage(update.toolCallId);
                this.handleToolCall(update);
                break;
            }
            case 'tool_call_update': {
                this.rememberReplayMessage(update.toolCallId);
                this.handleToolCallUpdate(update);
                break;
            }
            case 'session_info_update': {
                const retry = extractRateLimitRetryMeta(update._meta);
                if (retry !== undefined) {
                    this.eventBus.emit(
                        A2AEvents.ShowLoader,
                        getRateLimitRetryMessage(retry.attempt),
                    );
                    break;
                }

                this.logger.debug('acp-agent: ignoring session update session_info_update');
                break;
            }
            default: {
                this.logger.debug(`acp-agent: ignoring session update ${update.sessionUpdate}`);
            }
        }
    }

    snapshotMessages(): Array<{ id: string; text: string }> {
        return [...this.messageBuffers.entries()].map(([id, text]) => ({ id, text }));
    }

    snapshotReasoning(): Array<{ id: string; text: string }> {
        return [...this.reasoningBuffers.entries()].map(([id, text]) => ({ id, text }));
    }

    snapshotAssistantMessages(): AcpAssistantSnapshot[] {
        return this.assistantSnapshotOrder.map(({ kind, id }) => ({
            kind,
            id,
            text:
                (kind === 'message'
                    ? this.messageBuffers.get(id)
                    : this.reasoningBuffers.get(id)) ?? '',
        }));
    }

    snapshotReplayMessageOrder(): string[] {
        return [...this.replayMessageOrder];
    }

    reset(): void {
        this.messageBuffers.clear();
        this.reasoningBuffers.clear();
        this.toolCallBuffers.clear();
        this.assistantSnapshotOrder.length = 0;
        this.replayMessageOrder.length = 0;
        this.replayMessageIds.clear();
        this.fallbackIdGeneration += 1;
    }

    resetSession(): void {
        this.reset();
        this.canceledToolCallIds.clear();
    }

    cancelActiveToolCalls(): void {
        for (const toolCallId of this.toolCallBuffers.keys()) {
            this.cancelToolCall(toolCallId);
        }

        this.toolCallBuffers.clear();
    }

    cancelToolCall(toolCallId: string): void {
        this.canceledToolCallIds.add(toolCallId);

        const buffer = this.toolCallBuffers.get(toolCallId);
        if (buffer === undefined) {
            return;
        }

        this.toolEventBus.emit(A2AToolEvents.UpdateToolCall, toolCallId, {
            toolName: buffer.title,
            displayContent: buffer.title,
            toolArguments: stringifyUnknown(buffer.rawInput),
            toolOutput: buildToolOutput(buffer),
            status: 'canceled',
        });
    }

    private fallbackId(prefix: string): string {
        return `${prefix}-${this.fallbackIdGeneration}`;
    }

    private rememberReplayMessage(id: string | null | undefined): void {
        if (id === undefined || id === null || this.replayMessageIds.has(id)) {
            return;
        }

        this.replayMessageIds.add(id);
        this.replayMessageOrder.push(id);
    }

    private handleToolCall(toolCall: ToolCall): void {
        const buffer = this.mergeToolCallBuffer(toolCall);

        this.toolEventBus.emit(A2AToolEvents.ShowToolCall, toolCall.toolCallId, {
            type: A2AMessageTypes.ToolCallWithOutput,
            metadata: {
                toolName: buffer.title,
                displayContent: buffer.title,
                toolArguments: stringifyUnknown(buffer.rawInput),
                toolOutput: buildToolOutput(buffer),
                status: toWebviewStatus(buffer.status),
            },
        });

        this.clearToolCallIfTerminal(toolCall.toolCallId, buffer.status);
    }

    private handleToolCallUpdate(toolCall: ToolCallUpdate): void {
        const existed = this.toolCallBuffers.has(toolCall.toolCallId);
        const buffer = this.mergeToolCallBuffer(toolCall);

        if (!existed) {
            this.handleToolCall({
                toolCallId: toolCall.toolCallId,
                title: buffer.title,
                rawInput: buffer.rawInput,
                rawOutput: buffer.rawOutput,
                content: buffer.content,
                status: buffer.status,
            });
            return;
        }

        this.toolEventBus.emit(A2AToolEvents.UpdateToolCall, toolCall.toolCallId, {
            toolName: buffer.title,
            displayContent: buffer.title,
            toolArguments: stringifyUnknown(buffer.rawInput),
            toolOutput: buildToolOutput(buffer),
            status: toWebviewStatus(buffer.status),
        });

        this.clearToolCallIfTerminal(toolCall.toolCallId, buffer.status);
    }

    private mergeToolCallBuffer(toolCall: ToolCall | ToolCallUpdate): ToolCallBuffer {
        const existing = this.toolCallBuffers.get(toolCall.toolCallId);
        const buffer: ToolCallBuffer = {
            title: toolCall.title ?? existing?.title ?? toolCall.toolCallId,
            rawInput: toolCall.rawInput ?? existing?.rawInput,
            content: toolCall.content ?? existing?.content ?? [],
            rawOutput: toolCall.rawOutput ?? existing?.rawOutput,
            status: toolCall.status ?? existing?.status ?? 'in_progress',
        };

        this.toolCallBuffers.set(toolCall.toolCallId, buffer);

        return buffer;
    }

    private clearToolCallIfTerminal(toolCallId: string, status: ToolCallStatus): void {
        if (status === 'completed' || status === 'failed') {
            this.toolCallBuffers.delete(toolCallId);
        }
    }
}
