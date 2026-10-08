/** Внутренние типы протокола nessy serve (ACP session_update), см. docs/contract/README.md. */
import type { ToolStatus } from '../../../shared/types'

/** Накопленное состояние вызова инструмента: tool_call + все tool_call_update по toolCallId. */
export interface ToolCallBuffer {
	name: string
	title: string
	rawInput: unknown
	/** content[] последнего события, где он был (элементы type=content|diff|terminal) */
	content: unknown[]
	rawOutput: unknown
	status: ToolStatus
}

/** Ответ nessy на HTTP-запрос. */
export interface NessyResponse {
	status: number
	json: Record<string, unknown>
}
