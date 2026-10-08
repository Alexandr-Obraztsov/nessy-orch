import { createEvent } from './event-bus.js';
import type {
    TStateUpdate,
    TSessionId,
    TEnvironment,
    TAnalyticsRequestDetails,
    ISessionState,
    TPermissionDecision,
    TAgentMessageErrorMeta,
    IToolCall,
    TToolCallPresentation,
} from '../types.js';
import type { TLocalExtension } from './extensions/types.js';
import type { TTurnStatus } from './turn-types.js';
import type { TUserInvocableSkill } from '../skills/types.js';

export type TMessageEvent = {
    sessionId: TSessionId;
    messageId?: string;
    text: string;
    source?: string;
    target?: string;
    error?: TAgentMessageErrorMeta;
};

export type TThinkingEvent = {
    sessionId: TSessionId;
    messageId?: string;
    text: string;
    source?: string;
    target?: string;
};

export type TToolCallStartedEvent = {
    sessionId: TSessionId;
    toolCall: IToolCall;
    presentation: TToolCallPresentation;
};

export type TToolCallCompletedEvent = TToolCallStartedEvent & {
    result: string;
    permission?: { decision: TPermissionDecision | null };
};

export type TToolCallFailedEvent = TToolCallStartedEvent & {
    error: string;
    permission?: { decision: TPermissionDecision | null };
};

export type TModeChangedEvent = {
    sessionId: TSessionId;
    modeId: string;
};

export type TLocalExtensionsRefreshedEvent = {
    extensions: TLocalExtension[];
    sessionId?: TSessionId;
    cwd?: string;
};

export type TSkillsRefreshedEvent = {
    sessionId: TSessionId;
    skills: TUserInvocableSkill[];
};

export type TSkillWatchRequestedEvent = {
    cwd: string;
    extensionRoots: readonly string[];
};

export type TTurnStartedEvent = { sessionId: TSessionId; turnId: string };
export type TTurnStatusChangedEvent = {
    sessionId: TSessionId;
    turnId: string;
    status: TTurnStatus;
};
export type TTurnEndedEvent = { sessionId: TSessionId; turnId: string; status: TTurnStatus };
export type TRateLimitRetryScheduledEvent = {
    sessionId: TSessionId;
    attempt: number;
    maxRetries: number;
    delayMs: number;
};

export const sessionUpdate = createEvent<{ sessionId: TSessionId } & TStateUpdate>('sessionUpdate');
export const sessionCreated = createEvent<{
    sessionId: TSessionId;
    session: ISessionState;
}>('sessionCreated');
export const sessionLoaded = createEvent<{
    sessionId: TSessionId;
    session: ISessionState;
}>('sessionLoaded');
export const sessionClosed = createEvent<TSessionId>('sessionClosed');
export const cancelPrompt = createEvent<TSessionId>('cancelPrompt');
export const environmentUpdate = createEvent<Partial<TEnvironment>>('environmentUpdate');
export const analyticsRequestDetailsUpdate = createEvent<Partial<TAnalyticsRequestDetails>>(
    'analyticsRequestDetailsUpdate',
);
export const message = createEvent<TMessageEvent>('message');
export const thinking = createEvent<TThinkingEvent>('thinking');
export const toolCallStarted = createEvent<TToolCallStartedEvent>('toolCallStarted');
export const toolCallCompleted = createEvent<TToolCallCompletedEvent>('toolCallCompleted');
export const toolCallFailed = createEvent<TToolCallFailedEvent>('toolCallFailed');
export const modeChanged = createEvent<TModeChangedEvent>('modeChanged');
export const turnStarted = createEvent<TTurnStartedEvent>('turnStarted');
export const turnStatusChanged = createEvent<TTurnStatusChangedEvent>('turnStatusChanged');
export const turnEnded = createEvent<TTurnEndedEvent>('turnEnded');
export const rateLimitRetryScheduled =
    createEvent<TRateLimitRetryScheduledEvent>('rateLimitRetryScheduled');

export const localExtensionsRefreshed = createEvent<TLocalExtensionsRefreshedEvent>(
    'localExtensionsRefreshed',
);
export const skillsRefreshed = createEvent<TSkillsRefreshedEvent>('skillsRefreshed');
export const skillWatchRequested = createEvent<TSkillWatchRequestedEvent>('skillWatchRequested');
export const skillUnwatchRequested = createEvent<string>('skillUnwatchRequested');
export const skillFilesChanged = createEvent<string>('skillFilesChanged');
