export interface IToolCallResult {
    id: string;
    result: string;
    error?: string;
}

export type TToolCallResultWithContext = IToolCallResult & {
    toolCall: IToolCall;
    presentation: TToolCallPresentation;
};

export type TToolCallKind =
    | 'read'
    | 'edit'
    | 'delete'
    | 'move'
    | 'search'
    | 'execute'
    | 'think'
    | 'fetch'
    | 'switch_mode'
    | 'other';

type TToolCallLocation = {
    path: string;
    line?: number | null;
};

export type TToolCallContent =
    | {
          type: 'content';
          content: { type: 'text'; text: string };
      }
    | {
          type: 'diff';
          path: string;
          oldText?: string | null;
          newText: string;
      }
    | {
          type: 'terminal';
          terminalId: string;
      };

export type TToolCallPresentation = {
    title: string;
    kind: TToolCallKind;
    rawInput: Record<string, unknown>;
    locations: TToolCallLocation[];
    content: TToolCallContent[];
};

export interface IToolCall {
    readonly id: string;
    readonly index: number;
    readonly name: string;
    readonly arguments: string;
    readonly result: Promise<IToolCallResult>;
    respond(result: string): void;
    respondError(error: string): void;
}

export enum EAgentToolCallNames {
    'read_file' = 'read_file',
    'write_to_file' = 'write_to_file',
    'list_files' = 'list_files',
    'replace_in_file' = 'replace_in_file',
    'search_files' = 'search_files',
    'execute_command' = 'execute_command',
    'ask_followup_question' = 'ask_followup_question',
    'plan_mode_respond' = 'plan_mode_respond',
    'activate_skill' = 'activate_skill',
    'unknown' = 'unknown',
}

const TERMINAL_TOOLS: ReadonlySet<string> = new Set([
    EAgentToolCallNames.ask_followup_question,
    EAgentToolCallNames.plan_mode_respond,
]);

export function isTerminalTool(name: string): boolean {
    return TERMINAL_TOOLS.has(name);
}

export enum EToolImplementation {
    acp_basic = 'acp_basic',
    mcp = 'mcp',
    acp_advertising = 'acp_advertising',
    local = 'local',
}

export interface IToolImplementation {
    readonly type: EToolImplementation;
    isAvailable(): boolean;
    exec(
        sessionId: string,
        args: Record<string, unknown>,
        cwd: string,
        signal?: AbortSignal,
    ): Promise<string>;
}

export interface ITool {
    readonly permissionRequired: boolean;
    readonly name: EAgentToolCallNames;
    exec(sessionId: string, toolCall: IToolCall, cwd: string, signal?: AbortSignal): Promise<void>;
}
