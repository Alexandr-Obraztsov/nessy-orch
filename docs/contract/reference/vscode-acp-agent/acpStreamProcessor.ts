import { Message } from '@a2a-js/sdk';
import {
    McpServer as AcpMcpServer,
    ClientSideConnection,
    NewSessionResponse,
    RequestPermissionRequest,
    SessionModeState,
} from '@agentclientprotocol/sdk';
import { AcpAgentRuntime } from 'acp-agent';

import { Author, MessageInputState, SuggestionListItem } from '../../shared-webviews/src';
import { A2AMessage } from '../a2aAgent/a2aChat';
import { A2AHistoryManager } from '../a2aAgent/a2aHistoryManager';
import { A2AAgentWorkModes, A2AToolEventBus, A2AToolEvents } from '../a2aAgent/toolHandlers';
import { A2AEventBus, A2AEvents } from '../a2aAgent/types';
import { AbortTaskError } from '../a2aAgent/utils/errors/abortTaskError';
import { AgentResponseError } from '../a2aAgent/utils/errors/agentResponseError';
import { formatToError } from '../a2aAgent/utils/errors/formatToError';
import { AuthService } from '../auth/authService';
import { AcpHistoryManager } from './acpHistoryManager';
import { AcpIdeMcpServer, IDE_MCP_SERVER_NAME } from './acpIdeMcpServer';
import { requestAcpPermission } from './acpPermissionHandler';
import { AcpPermissionPrompt } from './acpPermissionPrompt';
import { AcpSessionUpdateAdapter, AcpTurnErrorMeta } from './acpSessionUpdateAdapter';
import { AcpSkillSuggestionsProvider } from './acpSkillSuggestionsProvider';
import { getAcpCwd, getAcpWorkspaceRoot } from './acpWorkspace';

const UNAUTHORIZED_CODE = 401;

interface SessionContext {
    cwd: string;
    chatId: string | undefined;
    sessionId: string | undefined;
}

export interface AcpStreamProcessorTelemetry {
    reportError(error: unknown, context: string): void;
}

export interface AcpStreamProcessorLogger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
}

/**
 * ACP-backed conversation engine. Sends prompts through a lazily-created ACP
 * session and translates the `session/update` stream into `A2AEventBus` render
 * events, mirroring the legacy `A2AStreamProcessor` behaviour.
 */
export class AcpStreamProcessor {
    private _isStreamProcessing = false;
    private lastMessage: Message | undefined;
    private pendingTurnError: AcpTurnErrorMeta | undefined;
    private currentTaskAbortPromise: Promise<never> | undefined;
    private lastKnownMode: A2AAgentWorkModes | undefined;
    private activeSession: { sessionId: string; chatId: string | undefined } | undefined;
    private sessionPreparation: { context: SessionContext; promise: Promise<string> } | undefined;
    private mcpSessionPreparation:
        | { cwd: string; connection: ClientSideConnection; promise: Promise<NewSessionResponse> }
        | undefined;

    private readonly connectionBySession = new Map<string, ClientSideConnection>();
    private readonly cwdBySession = new Map<string, string>();
    private readonly adapter: AcpSessionUpdateAdapter;
    private lastReplayMessageOrder: string[] = [];
    private readonly skillSuggestionsProvider = new AcpSkillSuggestionsProvider();

    constructor(
        private readonly runtime: AcpAgentRuntime,
        private readonly a2aHistoryManager: A2AHistoryManager,
        private readonly acpHistoryManager: AcpHistoryManager,
        private readonly a2aEventBus: A2AEventBus,
        private readonly a2aToolEventBus: A2AToolEventBus,
        private readonly permissionPrompt: AcpPermissionPrompt,
        private readonly authService: AuthService,
        private readonly ideMcpServer: AcpIdeMcpServer,
        private readonly logger: AcpStreamProcessorLogger,
        private readonly telemetry: AcpStreamProcessorTelemetry,
    ) {
        this.adapter = new AcpSessionUpdateAdapter(
            this.a2aEventBus,
            this.a2aToolEventBus,
            this.logger,
            (error) => this.onTurnError(error),
        );
        this.runtime.setRequestPermissionHandler((request) =>
            this.handlePermissionRequest(request),
        );
    }

    get isStreamProcessing(): boolean {
        return this._isStreamProcessing;
    }

    getCurrentSessionId(): string | undefined {
        return (
            this.acpHistoryManager.getCurrentChatAcpSessionId() ??
            (this.activeSession?.chatId === this.a2aHistoryManager.getCurrentChatId()
                ? this.activeSession?.sessionId
                : undefined)
        );
    }

    getSessionMode(): A2AAgentWorkModes | undefined {
        return this.lastKnownMode;
    }

    async ensureActiveSession(): Promise<string> {
        return this.ensureSession();
    }

    async ensureMcpSession(): Promise<string> {
        const cwd = getAcpCwd();
        const connection = await this.ensureConnection();
        const preparation = (this.mcpSessionPreparation ??= {
            cwd,
            connection,
            promise: this.buildSessionMcpServers().then((mcpServers) =>
                connection.newSession({ cwd, mcpServers }),
            ),
        });
        const isCurrent = () =>
            preparation.cwd === getAcpCwd() &&
            preparation.connection === this.runtime.getConnection();

        try {
            const response = await preparation.promise;
            if (isCurrent()) {
                return response.sessionId;
            }
        } catch (error) {
            if (this.mcpSessionPreparation === preparation) {
                this.mcpSessionPreparation = undefined;
            }
            if (isCurrent()) {
                throw error;
            }
        }

        if (this.mcpSessionPreparation === preparation) {
            this.mcpSessionPreparation = undefined;
        }
        return this.ensureMcpSession();
    }

    async startNewSession(): Promise<string> {
        const { chatId, cwd } = this.getSessionContext();
        const pendingPreparation = this.sessionPreparation;
        if (pendingPreparation !== undefined) {
            await pendingPreparation.promise.catch(() => undefined);
            if (this.sessionPreparation === pendingPreparation) {
                this.sessionPreparation = undefined;
            }
        }
        if (chatId !== this.a2aHistoryManager.getCurrentChatId() || cwd !== getAcpCwd()) {
            return this.ensureSession();
        }
        this.activeSession = undefined;
        await this.acpHistoryManager.setCurrentChatAcpSessionId(undefined);

        return this.ensureSession();
    }

    async sendStreamMessage(message: Message, taskAbortPromise: Promise<never>): Promise<void> {
        this.lastMessage = message;
        this.pendingTurnError = undefined;
        this.currentTaskAbortPromise = taskAbortPromise;
        this._isStreamProcessing = true;

        this.a2aEventBus.emit(A2AEvents.ShowLastAgentMessageError, '');
        this.a2aEventBus.emit(A2AEvents.SetMessageInputState, MessageInputState.ModelIsResponding);
        this.a2aEventBus.emit(A2AEvents.ShowLoader, 'Думаю...');

        try {
            const text = extractPromptText(message);
            let response = await this.prompt(text, taskAbortPromise);

            this.logger.debug(`acp-agent: prompt stopReason=${response.stopReason}`);

            if (this.hasUnauthorizedTurnError()) {
                const recovered = await this.recoverFromUnauthorized();

                if (recovered) {
                    this.pendingTurnError = undefined;
                    this.adapter.reset();
                    this.a2aEventBus.emit(A2AEvents.ShowLastAgentMessageError, '');

                    response = await this.prompt(text, taskAbortPromise);
                    this.logger.debug(`acp-agent: retry prompt stopReason=${response.stopReason}`);
                }
            }

            if (!this.hasTurnError()) {
                await this.persistAssistantMessages();
            }
        } catch (error) {
            if (error instanceof AbortTaskError) {
                return;
            }

            this.logger.error('acp-agent: sendStreamMessage failed', error);
            this.telemetry.reportError(error, 'send-stream-message');
            this.a2aEventBus.emit(A2AEvents.ShowError, formatToError(error), false);
        } finally {
            this._isStreamProcessing = false;
            this.currentTaskAbortPromise = undefined;
            this.adapter.reset();
            this.a2aEventBus.emit(A2AEvents.HideLoader);
            this.a2aEventBus.emit(A2AEvents.SetMessageInputState);
        }
    }

    async cancel(): Promise<void> {
        this.adapter.cancelActiveToolCalls();

        const sessionId = this.acpHistoryManager.getCurrentChatAcpSessionId();
        const connection = this.runtime.getConnection();

        if (sessionId === undefined || connection === undefined) {
            return;
        }

        try {
            await connection.cancel({ sessionId });
        } catch (error) {
            this.logger.error('acp-agent: cancel failed', error);
            this.telemetry.reportError(error, 'cancel');
        }
    }

    async prepareRetryMessage(): Promise<Message | undefined> {
        return this.lastMessage;
    }

    async setSessionMode(mode: A2AAgentWorkModes): Promise<void> {
        this.lastKnownMode = mode;

        const existing = this.getCurrentSessionId();

        if (existing !== undefined && this.isSessionLive(existing)) {
            await this.bindActiveSessionToCurrentChat(existing);
            await this.applySessionMode(existing, mode, 'set-session-mode');
            return;
        }

        await this.ensureSession();
    }

    async loadCurrentSession(): Promise<boolean> {
        const sessionId = this.acpHistoryManager.getCurrentChatAcpSessionId();
        const context = this.getSessionContext();

        if (sessionId === undefined) {
            return false;
        }

        try {
            return (
                (await this.ensureSession('replay')) === sessionId &&
                this.isSessionContextCurrent(context)
            );
        } catch {
            return false;
        }
    }

    getLastReplayMessageOrder(): string[] {
        return [...this.lastReplayMessageOrder];
    }

    private async loadSession(sessionId: string, context: SessionContext): Promise<boolean> {
        this.lastReplayMessageOrder = [];

        try {
            const connection = await this.ensureConnection();
            if (!this.isSessionContextCurrent(context)) {
                return false;
            }
            this.adapter.resetSession();

            this.connectionBySession.set(sessionId, connection);
            this.activeSession = { sessionId, chatId: context.chatId };
            this.runtime.registerSession(sessionId, (update) => this.dispatchSessionUpdate(update));

            const response = await connection.loadSession({
                sessionId,
                cwd: context.cwd,
                mcpServers: await this.buildSessionMcpServers(),
            });

            if (this.isSessionContextCurrent(context)) {
                this.lastReplayMessageOrder = this.adapter.snapshotReplayMessageOrder();
            }

            if (this.isSessionContextCurrent(context)) {
                await this.initializeSessionMode(sessionId, response);
            }
            this.cwdBySession.set(sessionId, context.cwd);

            return true;
        } catch (error) {
            if (this.activeSession?.sessionId === sessionId) {
                this.activeSession = undefined;
            }
            this.connectionBySession.delete(sessionId);
            this.cwdBySession.delete(sessionId);
            this.logger.error('acp-agent: load session failed', error);
            this.telemetry.reportError(error, 'load-session');

            return false;
        } finally {
            this.adapter.reset();
        }
    }

    async searchSkillSuggestions(query: string): Promise<SuggestionListItem[]> {
        try {
            const cwd = getAcpWorkspaceRoot();

            if (cwd === undefined) {
                return [];
            }

            const connection = await this.ensureConnection();

            return await this.skillSuggestionsProvider.search(connection, cwd, query);
        } catch (error) {
            this.logger.error('acp-agent: skill suggestions failed', error);
            this.telemetry.reportError(error, 'skill-suggestions');

            return [];
        }
    }

    async regenerateResponse(taskAbortPromise: Promise<never>): Promise<boolean> {
        const sessionId = this.acpHistoryManager.getCurrentChatAcpSessionId();

        if (sessionId === undefined) {
            return false;
        }

        this.pendingTurnError = undefined;
        this.currentTaskAbortPromise = taskAbortPromise;
        this._isStreamProcessing = true;
        this.adapter.reset();

        this.a2aEventBus.emit(A2AEvents.ShowLastAgentMessageError, '');
        this.a2aEventBus.emit(A2AEvents.SetMessageInputState, MessageInputState.ModelIsResponding);
        this.a2aEventBus.emit(A2AEvents.ShowLoader, 'Думаю...');

        try {
            const connection =
                this.connectionBySession.get(sessionId) ?? (await this.ensureConnection());

            this.connectionBySession.set(sessionId, connection);

            const response = await Promise.race([
                connection.extMethod('nestor/session/regenerate', { sessionId }),
                taskAbortPromise,
            ]);

            this.logger.debug(
                `acp-agent: regenerate stopReason=${String(response.stopReason ?? 'unknown')}`,
            );

            if (!this.hasTurnError()) {
                await this.persistAssistantMessages();
            }

            return true;
        } catch (error) {
            if (error instanceof AbortTaskError) {
                return false;
            }

            this.logger.error('acp-agent: regenerate failed', error);
            this.telemetry.reportError(error, 'regenerate-response');
            this.a2aEventBus.emit(A2AEvents.ShowError, formatToError(error), false);

            return false;
        } finally {
            this._isStreamProcessing = false;
            this.currentTaskAbortPromise = undefined;
            this.adapter.reset();
            this.a2aEventBus.emit(A2AEvents.HideLoader);
            this.a2aEventBus.emit(A2AEvents.SetMessageInputState);
        }
    }

    dispose(): void {
        this.connectionBySession.clear();
        this.cwdBySession.clear();
        this.ideMcpServer.dispose();
    }

    private dispatchSessionUpdate(update: Parameters<AcpSessionUpdateAdapter['handle']>[0]): void {
        if (update.sessionId !== this.getCurrentSessionId()) {
            return;
        }
        try {
            if (update.update.sessionUpdate === 'current_mode_update') {
                this.applySessionModeId({
                    currentModeId: update.update.currentModeId,
                    availableModes: [],
                });
            }

            this.adapter.handle(update);
        } catch (error) {
            this.logger.error('acp-agent: session update handling failed', error);
            this.telemetry.reportError(error, 'session-update');
        }
    }

    private hasUnauthorizedTurnError(): boolean {
        return this.pendingTurnError?.code === UNAUTHORIZED_CODE;
    }

    private hasTurnError(): boolean {
        return this.pendingTurnError !== undefined;
    }

    private async persistAssistantMessages(): Promise<void> {
        for (const snapshot of this.adapter.snapshotAssistantMessages()) {
            const { id, text } = snapshot;

            if (text.trim().length === 0) {
                continue;
            }

            await this.a2aHistoryManager.addMessageInCurrentChat(
                new A2AMessage(
                    id,
                    Author.Assistant,
                    snapshot.kind === 'message'
                        ? [
                              {
                                  content: { $case: 'text', value: text },
                                  metadata: undefined,
                                  filename: '',
                                  mediaType: 'text/plain',
                              },
                          ]
                        : [
                              {
                                  content: { $case: 'data', value: { reasoning: text } },
                                  metadata: undefined,
                                  filename: '',
                                  mediaType: 'application/json',
                              },
                          ],
                ),
            );
        }
    }

    private onTurnError(error: AcpTurnErrorMeta): void {
        this.pendingTurnError = error;

        this.telemetry.reportError(
            new Error(`acp-agent: turn error (code=${error.code ?? 'unknown'})`),
            'turn-error',
        );

        this.a2aEventBus.emit(
            A2AEvents.ShowError,
            new AgentResponseError(error.message, error.code, error.requestId),
            Boolean(error.retryable),
        );
    }

    private async prompt(text: string, taskAbortPromise: Promise<never>) {
        const sessionId = await Promise.race([this.ensureSession(), taskAbortPromise]);
        const connection = this.connectionBySession.get(sessionId);

        if (connection === undefined) {
            throw new Error(`acp-agent: no connection for session ${sessionId}`);
        }

        return Promise.race([
            connection.prompt({ sessionId, prompt: [{ type: 'text', text }] }),
            taskAbortPromise,
        ]);
    }

    private async handlePermissionRequest(request: RequestPermissionRequest) {
        const response = await requestAcpPermission(
            request,
            this.permissionPrompt,
            this.currentTaskAbortPromise,
            this.logger,
            this.telemetry,
        );

        const selectedOptionId =
            response.outcome.outcome === 'selected' ? response.outcome.optionId : undefined;
        const selectedOption = request.options.find(
            (option) => option.optionId === selectedOptionId,
        );
        const wasRejected =
            response.outcome.outcome === 'cancelled' ||
            selectedOption?.kind === 'reject_once' ||
            selectedOption?.kind === 'reject_always';

        if (wasRejected) {
            this.adapter.cancelToolCall(request.toolCall.toolCallId);
        }

        return response;
    }

    private async recoverFromUnauthorized(): Promise<boolean> {
        try {
            await this.authService.registerUnauthorizedError();

            const result = await this.runtime.restart();

            this.activeSession = undefined;
            this.connectionBySession.clear();
            this.cwdBySession.clear();
            await this.acpHistoryManager.setCurrentChatAcpSessionId(undefined);

            if (result.status !== 'ready') {
                throw new Error(`acp-agent: runtime not ready after restart (${result.reason})`);
            }

            return true;
        } catch (error) {
            this.logger.error('acp-agent: 401 recovery failed', error);
            this.telemetry.reportError(error, 'recover-unauthorized');

            return false;
        }
    }

    private async ensureSession(mode: 'ready' | 'replay' = 'ready'): Promise<string> {
        let preparation = this.sessionPreparation;
        if (preparation === undefined) {
            const context = this.getSessionContext();
            const existing = context.sessionId;
            if (
                mode === 'ready' &&
                existing !== undefined &&
                this.isSessionLive(existing, context.cwd)
            ) {
                await this.bindActiveSessionToCurrentChat(existing);
                return this.isSessionContextCurrent(context) &&
                    this.sessionPreparation === undefined
                    ? existing
                    : this.ensureSession(mode);
            }

            preparation = { context, promise: this.restoreOrCreateSession(context) };
            this.sessionPreparation = preparation;
        }

        try {
            const sessionId = await preparation.promise;

            if (this.isSessionContextCurrent(preparation.context, sessionId)) {
                return sessionId;
            }
        } catch (error) {
            if (this.isSessionContextCurrent(preparation.context)) {
                throw error;
            }
        } finally {
            if (this.sessionPreparation === preparation) {
                this.sessionPreparation = undefined;
            }
        }

        return this.ensureSession(mode);
    }

    private getSessionContext(): SessionContext {
        return {
            cwd: getAcpCwd(),
            chatId: this.a2aHistoryManager.getCurrentChatId(),
            sessionId: this.getCurrentSessionId(),
        };
    }

    private isSessionContextCurrent(
        context: SessionContext,
        sessionId = context.sessionId,
    ): boolean {
        return (
            context.cwd === getAcpCwd() &&
            context.chatId === this.a2aHistoryManager.getCurrentChatId() &&
            sessionId === this.getCurrentSessionId()
        );
    }

    private async restoreOrCreateSession(context: SessionContext): Promise<string> {
        const { sessionId, cwd } = context;
        const sessionCwd = sessionId === undefined ? undefined : this.cwdBySession.get(sessionId);

        if (sessionId !== undefined && (sessionCwd === undefined || sessionCwd === cwd)) {
            if (!(await this.loadSession(sessionId, context))) {
                throw new Error(`acp-agent: failed to restore session ${sessionId}`);
            }
            return sessionId;
        }

        return this.createSession(context);
    }

    private isSessionLive(sessionId: string, cwd = getAcpCwd()): boolean {
        const connection = this.runtime.getConnection();

        return (
            connection !== undefined &&
            this.sessionPreparation === undefined &&
            this.connectionBySession.get(sessionId) === connection &&
            this.cwdBySession.get(sessionId) === cwd
        );
    }

    private async createSession(context: SessionContext): Promise<string> {
        this.adapter.resetSession();
        const connection = await this.ensureConnection();

        const response = await connection.newSession({
            cwd: context.cwd,
            mcpServers: await this.buildSessionMcpServers(),
        });
        const { sessionId } = response;

        if (!this.isSessionContextCurrent(context)) {
            this.logger.info(
                `acp-agent: ignored session ${sessionId} created for an inactive chat or workspace`,
            );
            return sessionId;
        }

        context.sessionId = sessionId;
        await this.bindActiveSessionToCurrentChat(sessionId);
        this.connectionBySession.set(sessionId, connection);
        this.cwdBySession.set(sessionId, context.cwd);
        this.runtime.registerSession(sessionId, (update) => this.dispatchSessionUpdate(update));
        if (this.isSessionContextCurrent(context, sessionId)) {
            await this.initializeSessionMode(sessionId, response);
        }

        this.logger.info(`acp-agent: created session ${sessionId}`);

        return sessionId;
    }

    private async bindActiveSessionToCurrentChat(sessionId: string): Promise<void> {
        this.activeSession = { sessionId, chatId: this.a2aHistoryManager.getCurrentChatId() };
        await this.acpHistoryManager.setCurrentChatAcpSessionId(sessionId);
    }

    private applySessionModeState(modes: SessionModeState | null | undefined): void {
        this.applySessionModeId(modes);
    }

    private applySessionModeId(modes: SessionModeState | null | undefined): void {
        const modeId = modes?.currentModeId;
        const mode = toAgentWorkMode(modeId);

        if (mode === undefined) {
            if (modeId !== undefined) {
                const availableModeIds =
                    modes?.availableModes?.map((availableMode) => availableMode.id).join(', ') ??
                    '';

                this.logger.warn(
                    `acp-agent: unknown session mode '${modeId}', defaulting to '${A2AAgentWorkModes.ACT}'` +
                        (availableModeIds.length > 0
                            ? ` (availableModes=${availableModeIds})`
                            : ''),
                );
                this.lastKnownMode = A2AAgentWorkModes.ACT;
                this.a2aToolEventBus.emit(A2AToolEvents.SetAgentWorkMode, A2AAgentWorkModes.ACT);
            }

            return;
        }

        this.lastKnownMode = mode;
        this.a2aToolEventBus.emit(A2AToolEvents.SetAgentWorkMode, mode);
    }

    private async initializeSessionMode(
        sessionId: string,
        response: Pick<NewSessionResponse, 'modes'>,
    ): Promise<void> {
        const modeToRestore = this.lastKnownMode;

        if (modeToRestore === undefined) {
            this.applySessionModeState(response.modes);
            return;
        }

        if (response.modes?.currentModeId === modeToRestore) {
            this.applySessionModeState(response.modes);
            return;
        }

        await this.applySessionMode(sessionId, modeToRestore, 'restore-session-mode');
    }

    private async applySessionMode(
        sessionId: string,
        mode: A2AAgentWorkModes,
        telemetryContext: string,
    ): Promise<void> {
        const context = this.getSessionContext();
        const connection = this.connectionBySession.get(sessionId);

        if (connection?.setSessionMode === undefined || context.sessionId !== sessionId) {
            return;
        }

        try {
            await connection.setSessionMode({ sessionId, modeId: mode });
            if (this.isSessionContextCurrent(context)) {
                this.a2aToolEventBus.emit(A2AToolEvents.SetAgentWorkMode, mode);
            }
        } catch (error) {
            this.logger.error(`acp-agent: ${telemetryContext} failed`, error);
            this.telemetry.reportError(error, telemetryContext);
            throw error;
        }
    }

    private async buildSessionMcpServers(): Promise<AcpMcpServer[]> {
        try {
            const url = await this.ideMcpServer.ensureStarted();

            return [{ type: 'http', name: IDE_MCP_SERVER_NAME, url, headers: [] }];
        } catch (error) {
            this.logger.error('acp-agent: IDE MCP server start failed', error);
            this.telemetry.reportError(error, 'ide-mcp-start');

            return [];
        }
    }

    private async ensureConnection(): Promise<ClientSideConnection> {
        const existing = this.runtime.getConnection();

        if (existing !== undefined) {
            return existing;
        }

        const result = await this.runtime.start();

        if (result.status !== 'ready') {
            throw new Error(`acp-agent: runtime not ready (${result.reason})`);
        }

        return result.connection;
    }
}

function extractPromptText(message: Message): string {
    return message.parts
        .map((part) => (part.content?.$case === 'text' ? part.content.value : ''))
        .join('');
}

function toAgentWorkMode(mode: string | undefined): A2AAgentWorkModes | undefined {
    if (mode === A2AAgentWorkModes.ACT || mode === A2AAgentWorkModes.PLAN) {
        return mode;
    }

    return undefined;
}
