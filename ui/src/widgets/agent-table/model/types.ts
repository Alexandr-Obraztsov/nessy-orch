import type { AgentView } from '@contract'
import type { AgentGroup, AgentState } from '@/entities/agent'

/** Строка таблицы: агент и всё, что нужно для показа. */
export interface AgentRowModel {
	agent: AgentView
	state: AgentState
	/** группа с учётом «задержки»: только что закончивший ещё секунду стоит в «Работают» */
	group: AgentGroup
	/** задача (первая строка поручения) */
	task: string
	role: { name: string; hue: number } | null
	/** только что закончил — метка «новое» */
	fresh: boolean
	/** только что получил разрешение — короткая подсветка строки */
	flash: boolean
}

export interface TableGroup {
	key: AgentGroup
	rows: AgentRowModel[]
}

/** Недавние переходы состояний (для анимаций): id агента → момент перехода. */
export interface Transitions {
	/** закончил задачу: держим в «Работают» HOLD_MS, затем переезд в «Выполнено» */
	held: Set<string>
	fresh: Set<string>
	flash: Set<string>
}

export interface AgentRowProps {
	row: AgentRowModel
	selected: boolean
	/** текущее время для живых таймеров; 0 — строке таймеры не нужны (не перерисовываем) */
	now: number
	onOpen: (id: string) => void
}

export interface GroupHeaderProps {
	group: TableGroup
	collapsed: boolean
	onToggle: () => void
}
