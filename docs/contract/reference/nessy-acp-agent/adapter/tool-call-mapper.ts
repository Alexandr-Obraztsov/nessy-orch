import type { ToolCall, ToolCallStatus, ToolCallUpdate } from '@agentclientprotocol/sdk';
import { EAgentToolCallNames, type IToolCall, type TToolCallPresentation } from '../../types.js';
import { toAcpToolCallContent } from './acp-mappers.js';
import type { TAcpClientCompatibility } from './client-compatibility.js';

const FILE_DISCOVERY_TOOLS: ReadonlySet<string> = new Set([
    EAgentToolCallNames.search_files,
    EAgentToolCallNames.list_files,
]);

export interface IAcpToolCallMapper {
    toToolCall(
        toolCall: IToolCall,
        presentation: TToolCallPresentation,
        status: ToolCallStatus,
    ): ToolCall;

    toToolCallUpdate(toolCall: IToolCall, presentation?: TToolCallPresentation): ToolCallUpdate;
}

export class AcpToolCallMapper implements IAcpToolCallMapper {
    constructor(private compatibility: TAcpClientCompatibility) {}

    toToolCall(
        toolCall: IToolCall,
        presentation: TToolCallPresentation,
        status: ToolCallStatus,
    ): ToolCall {
        return {
            ...this.toToolCallUpdate(toolCall, presentation),
            status,
        } as ToolCall;
    }

    toToolCallUpdate(toolCall: IToolCall, presentation?: TToolCallPresentation): ToolCallUpdate {
        const requiresSearchCompatibility =
            presentation?.kind === 'search' || FILE_DISCOVERY_TOOLS.has(toolCall.name);

        return {
            toolCallId: toolCall.id,
            title: presentation?.title ?? toolCall.name,
            kind:
                requiresSearchCompatibility && !this.compatibility.supportsSearchKind
                    ? 'other'
                    : (presentation?.kind ?? 'other'),
            rawInput: presentation?.rawInput ?? toolCall.arguments,
            locations:
                requiresSearchCompatibility && !this.compatibility.supportsSearchLocations
                    ? []
                    : (presentation?.locations ?? []),
            content: presentation ? toAcpToolCallContent(presentation.content) : [],
        };
    }
}

export function createDefaultAcpToolCallMapper(): AcpToolCallMapper {
    return new AcpToolCallMapper({
        supportsSearchKind: true,
        supportsSearchLocations: true,
    });
}
