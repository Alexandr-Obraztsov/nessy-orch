import type { AgentView, Message, SpaceView } from '@contract'

export type Conn = 'connecting' | 'live' | 'offline'

export interface State {
	conn: Conn
	rev: number
	spaces: SpaceView[]
	agents: AgentView[]
	/** общая лента, по возрастанию seq */
	messages: Message[]
	/** момент последнего полученного события */
	lastEventAt: number
}

export type MessageListener = (m: Message) => void
