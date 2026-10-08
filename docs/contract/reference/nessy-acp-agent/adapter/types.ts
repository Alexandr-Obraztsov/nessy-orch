import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import type {
    TClientCapabilities,
    TPermissionDecision,
    IToolCall,
    TToolCallPresentation,
    IPermissionOption,
    IPermissionOutcome,
} from '../../types.js';

export interface IACPAdapter {
    readonly connection: AgentSideConnection;
    readonly capabilities: TClientCapabilities;
}

export interface IPermissionAdapter {
    requestPermission(
        sessionId: string,
        toolCall: IToolCall,
        presentation: TToolCallPresentation | undefined,
        signal: AbortSignal | undefined,
        permissionOptions?: IPermissionOption[],
    ): Promise<TPermissionDecision | IPermissionOutcome | null>;
}
