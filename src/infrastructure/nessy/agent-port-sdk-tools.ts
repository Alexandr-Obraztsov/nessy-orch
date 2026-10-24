/** Маппинг tool-блоков SDK → события порта (§3 tool_call.started/completed). Выделено из agent-port-sdk.ts
 *  по единой ответственности и лимиту max-lines: только «tool_use → started», «tool_result → completed». */
import type { PortEvent } from '../../application/agent-port'
import { isObject } from '../../lib/json'
import type { SessionState } from './agent-port-sdk-session'

/** Эмитер порта: закрывает над состоянием (проверка closed, seq, подписчик) — передаётся адаптером. */
export type Emit = (state: SessionState, ev: PortEvent) => void

/** tool_use-блок → tool_call.started; запоминаем имя для парного tool_result (§3). */
export function emitToolUse(state: SessionState, emit: Emit, toolId: string, name: string, input: unknown): void {
	const inputObj = isObject(input) ? (input as Record<string, unknown>) : {}
	state.pendingTools.set(toolId, { name, input: inputObj })
	emit(state, { type: 'tool_call.started', data: { toolId, name, title: name, input: inputObj } })
}

/** tool_result-блок → tool_call.completed (status completed/failed, output из результата) (§3). */
export function emitToolResult(
	state: SessionState,
	emit: Emit,
	toolUseId: string,
	content: string | unknown[] | undefined,
	isError: boolean | undefined,
): void {
	const pending = state.pendingTools.get(toolUseId)
	if (pending) state.pendingTools.delete(toolUseId)
	const name = pending?.name ?? 'tool'
	emit(state, {
		type: 'tool_call.completed',
		data: { toolId: toolUseId, name, title: name, status: isError ? 'failed' : 'completed', output: toolResultText(content) },
	})
}

/** Текст результата tool_result: строка как есть, блоки — склейка text-блоков (§3, tool_call.completed.output). */
export function toolResultText(content: string | unknown[] | undefined): string {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	const out: string[] = []
	for (const b of content) {
		if (isObject(b) && b['type'] === 'text' && typeof b['text'] === 'string') out.push(b['text'])
	}
	return out.join('')
}
