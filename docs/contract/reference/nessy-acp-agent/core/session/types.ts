import type { EAgentToolCallNames, ITool, TToolCallPresentation } from '../../types.js';
import type { TStreamEvent, TTransportSendArgs } from '../turn-types.js';
import type { TContextId, TTaskId, TPermissionDecision } from '../../types.js';
import type { TPermissionResolveMethod } from '../permission/types.js';

// ============================================================================
// Session Core Types
// ============================================================================

export type TSessionId = string;

export type TSessionModes = {
    availableModes: TSessionMode[];
    currentModeId: string;
};

export type TSessionMode = {
    id: string;
    name: string;
    description?: string;
};

// ============================================================================
// Session History Types
// ============================================================================

export type TSessionHistoryRole = 'user' | 'agent';

export type TAgentMessageErrorMeta = {
    retryable?: true;
    code?: number;
    requestId?: string;
};

export type TSessionResourceLink = {
    uri: string;
    name: string;
    title?: string;
    description?: string;
    mimeType?: string;
    size?: number;
};

type TSessionPromptContentBlockText = {
    type: 'text';
    text: string;
};

type TSessionPromptContentMetadata = {
    type: 'metadata';
    key: string;
    content: unknown;
};

type TSessionPromptContentBlockResourceLink = {
    type: 'resource_link';
} & TSessionResourceLink;

export type TSessionPromptContentBlock =
    | TSessionPromptContentBlockText
    | TSessionPromptContentBlockResourceLink
    | TSessionPromptContentMetadata;

export type TSessionHistoryMessage = {
    kind: 'message';
    messageId: string;
    role: TSessionHistoryRole;
    text: string;
    error?: TAgentMessageErrorMeta;
    content?: TSessionPromptContentBlock[];
    createdAt: string;
};

export type TSessionHistoryToolCall = {
    kind: 'tool_call';
    toolCallId: string;
    name: string;
    presentation: TToolCallPresentation;
    status: 'completed' | 'failed';
    result?: string;
    error?: string;
    permission?: { decision: TPermissionDecision | null };
    createdAt: string;
};

type TSessionHistoryThought = {
    kind: 'thought';
    messageId: string;
    text: string;
    createdAt: string;
};

export type TSessionHistoryEntry =
    | TSessionHistoryMessage
    | TSessionHistoryThought
    | TSessionHistoryToolCall;

// ============================================================================
// Session State Types
// ============================================================================

export type TTaskState =
    | 'submitted'
    | 'working'
    | 'input-required'
    | 'completed'
    | 'canceled'
    | 'failed'
    | 'rejected'
    | 'auth-required'
    | 'unknown';

export type TStateUpdate = {
    contextId?: TContextId;
    taskId?: TTaskId;
    taskStatus?: TTaskState;
    clearTask?: boolean;
};

export interface IAgentBridge {
    sendInitial(args: TTransportSendArgs): AsyncIterable<TStreamEvent>;
    sendContinuation(args: TTransportSendArgs): AsyncIterable<TStreamEvent>;
    cancelTask(taskId: TTaskId): Promise<TTaskState | undefined>;
    getModes(): Promise<TSessionModes | undefined>;
}

export interface ISessionState {
    id: TSessionId;
    cwd: string;
    mcpServers?: unknown[];
    createdAt: string;
    updatedAt: string;
    title?: string;
    history: TSessionHistoryEntry[];
    pendingPrompt: AbortController | null;
    bridge: IAgentBridge | null;
    tools: Map<EAgentToolCallNames, ITool>;
    isAttached: boolean;
    permissions: Map<string, TPermissionDecision>;
    permissionResolveMethod?: TPermissionResolveMethod;
    contextId?: TContextId;
    taskId?: TTaskId;
    taskStatus?: TTaskState;
    pendingToolCall?: { id: string };
    modes?: TSessionModes;
    loadedFromHistory?: boolean;
}

// ============================================================================
// Session Manager Types
// ============================================================================

export type TSessionInfo = {
    sessionId: TSessionId;
    cwd: string;
    title?: string;
    updatedAt: string;
};

export interface ISessionManager {
    create(args: {
        cwd: string;
        mcpServers?: unknown[];
        bridge: IAgentBridge | null;
        tools: Map<EAgentToolCallNames, ITool>;
        modes?: TSessionModes;
        permissionResolveMethod?: TPermissionResolveMethod;
    }): ISessionState;
    load(args: {
        sessionId: TSessionId;
        cwd: string;
        mcpServers?: unknown[];
        bridge: IAgentBridge | null;
        tools: Map<EAgentToolCallNames, ITool>;
        modes?: TSessionModes;
    }): ISessionState;
    list(args?: { cwd?: string | null; cursor?: string | null }): {
        sessions: TSessionInfo[];
        nextCursor?: string | null;
    };
    get(sessionId: TSessionId): ISessionState | undefined;
    recordUserMessage(
        sessionId: TSessionId,
        text: string,
        messageId?: string,
        content?: TSessionPromptContentBlock[],
    ): string | undefined;
    recordAgentMessage(
        sessionId: TSessionId,
        text: string,
        messageId?: string,
        error?: TAgentMessageErrorMeta,
    ): string | undefined;
    recordThought(sessionId: TSessionId, text: string, messageId?: string): string | undefined;
    removeLastRetryableAgentError(sessionId: TSessionId): void;
    recordToolCall(
        sessionId: TSessionId,
        entry: Omit<TSessionHistoryToolCall, 'kind' | 'createdAt'>,
    ): void;
    setPendingToolCall(sessionId: TSessionId, toolCallId: string | undefined): void;
    setPermission(sessionId: TSessionId, toolName: string, decision: TPermissionDecision): void;
    startPrompt(sessionId: TSessionId): AbortSignal;
    finishPrompt(sessionId: TSessionId): void;
    cancel(sessionId: TSessionId): void;
    close(sessionId: TSessionId): void;
    setMode(sessionId: TSessionId, modeId: string): void;
}

// ============================================================================
// Session Storage Types
// ============================================================================

export type TSessionRecord =
    | {
          kind: 'session_created';
          sessionId: TSessionId;
          cwd: string;
          createdAt: string;
          modes?: TSessionModes;
          permissionResolveMethod?: TPermissionResolveMethod;
      }
    | { kind: 'title_set'; title: string; createdAt: string }
    | {
          kind: 'message_chunk';
          messageId: string;
          role: TSessionHistoryRole;
          text: string;
          error?: TAgentMessageErrorMeta;
          content?: TSessionPromptContentBlock[];
          createdAt: string;
      }
    | {
          kind: 'thought_chunk';
          messageId: string;
          text: string;
          createdAt: string;
      }
    | { kind: 'message_removed'; messageId: string; createdAt: string }
    | {
          kind: 'tool_call';
          toolCallId: string;
          name: string;
          presentation: TToolCallPresentation;
          status: 'completed' | 'failed';
          result?: string;
          error?: string;
          permission?: { decision: TPermissionDecision | null };
          createdAt: string;
      }
    | {
          kind: 'permission_set';
          toolName: string;
          decision: TPermissionDecision;
          createdAt: string;
      }
    | { kind: 'mode_changed'; modeId: string; createdAt: string }
    | {
          kind: 'state_update';
          contextId?: TContextId;
          taskId?: TTaskId;
          taskStatus?: TTaskState;
          clearTask?: boolean;
          createdAt: string;
      }
    | { kind: 'pending_tool_call_set'; toolCallId: string | null; createdAt: string }
    | { kind: 'session_closed'; createdAt: string };

export type TSessionMetadata = {
    sessionId: TSessionId;
    mtimeMs: number;
};

export interface ISessionStorage {
    loadAll(): Map<TSessionId, TSessionRecord[]>;
    append(sessionId: TSessionId, record: TSessionRecord): void;
    delete(sessionId: TSessionId): void;
    listMetadata(): TSessionMetadata[];
}
