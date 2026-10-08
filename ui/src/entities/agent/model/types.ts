import type { AgentEvent, AgentView } from '@contract'

/** Блок незавершённого текста/мыслей, собранный из chunk-событий. */
export interface LiveRun {
	seq: number
	ts: number
	kind: 'text' | 'thought'
	text: string
}

export interface AgentStreamState {
	/** события по возрастанию seq (tool-события обновляются на месте) */
	events: AgentEvent[]
	/** незавершённые блоки текста, ключ — seq */
	live: LiveRun[]
	agent: AgentView | null
	/** история проиграна, дальше — живые события */
	ready: boolean
	connected: boolean
}
