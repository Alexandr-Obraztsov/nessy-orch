import type { AvailableCommand, ToolCallContent } from '@agentclientprotocol/sdk';
import type { TToolCallContent, TToolCallPresentation } from '../../types.js';
import type { TUserInvocableSkill } from '../../skills/types.js';

export function toAcpAvailableCommands(skills: TUserInvocableSkill[]): AvailableCommand[] {
    return skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        ...(skill.argumentHint ? { input: { hint: skill.argumentHint } } : {}),
    }));
}

export function toAcpToolCallContent(content: TToolCallContent[]): ToolCallContent[] {
    return content.map((block) => {
        if (block.type === 'content') {
            return block;
        }
        if (block.type === 'terminal') {
            return block;
        }

        return {
            type: 'diff',
            path: block.path,
            oldText: block.oldText ?? null,
            newText: block.newText,
        };
    });
}

export function toAcpResultContent(
    presentation: TToolCallPresentation,
    result: string,
): ToolCallContent[] {
    const content = toAcpToolCallContent(presentation.content);
    if (presentation.kind === 'edit' || result.trim() === '') {
        return content;
    }

    return [...content, { type: 'content', content: { type: 'text', text: result } }];
}
