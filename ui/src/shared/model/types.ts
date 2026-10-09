import type { AgentView, Message, RoleView, SpaceView, TaskView } from '@contract'

export type Conn = 'connecting' | 'live' | 'offline'

export interface State {
	conn: Conn
	rev: number
	spaces: SpaceView[]
	agents: AgentView[]
	roles: RoleView[]
	/** задачи («ящики») оркестраторов */
	tasks: TaskView[]
	/** общая лента, по возрастанию seq */
	messages: Message[]
	/** момент последнего полученного события */
	lastEventAt: number
}
