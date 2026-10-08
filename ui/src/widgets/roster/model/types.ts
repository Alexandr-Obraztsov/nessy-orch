import type { AgentView, SpaceView } from '@contract'

export interface RosterGroup {
	/** имя пространства */
	key: string
	/** null — пространство уже удалено, но агенты ещё числятся в нём */
	space: SpaceView | null
	hue: number
	/** живые агенты, отсортированы: работающие сверху, далее по последней активности */
	alive: AgentView[]
	/** остановленные */
	dead: AgentView[]
	working: number
	/** всего агентов в пространстве (без учёта поиска) */
	total: number
}
