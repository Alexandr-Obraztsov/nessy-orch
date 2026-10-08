import type { AgentView, SpaceView } from '@contract'

/** Папка пространства в дереве агентов. */
export interface SpaceFolder {
	key: string
	space: SpaceView | null
	agents: AgentView[]
	working: number
}

export type SectionId = 'agents' | 'archive' | 'roles' | 'spaces'

export interface CollapseState {
	sections: Partial<Record<SectionId, boolean>>
	/** свёрнутые папки пространств */
	folders: Record<string, boolean>
}
