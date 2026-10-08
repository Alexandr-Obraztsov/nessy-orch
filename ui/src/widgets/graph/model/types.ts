import type { SimulationNodeDatum } from 'd3-force'
import type { AgentStatus } from '@contract'

/** Узел для отрисовки (данные, без координат). */
export interface NodeDatum {
	id: string
	you: boolean
	name: string
	space: string | null
	hue: number
	status: AgentStatus | null
	parent: string | null
	/** глубина от «Вы» по цепочке parent (Вы = 0) */
	depth: number
	queued: number
	perms: number
	/** узел удалён из стора и доигрывает анимацию исчезновения */
	leaving: boolean
}

export type EdgeKind = 'parent' | 'comm'

/** Ребро графа: parent (кто кого запустил) или агрегат переписки пары узлов. */
export interface EdgeDatum {
	id: string
	kind: EdgeKind
	/** концы ребра; для comm — в лексикографическом порядке */
	a: string
	b: string
	/** число сообщений (comm) */
	count: number
	/** время последнего сообщения, мс */
	lastTs: number
	/** последнее сообщение не доставлено */
	lastFailed: boolean
}

/** Сектор пространства вокруг центра. */
export interface SectorDatum {
	space: string
	hue: number
	/** центральный угол сектора, рад */
	angle: number
}

/** Узел симуляции d3-force. */
export interface SimNode extends SimulationNodeDatum {
	id: string
	r: number
	depth: number
	space: string | null
	parent: string | null
}

export interface SimLink {
	source: string | SimNode
	target: string | SimNode
	kind: EdgeKind
}

export type PacketTone = 'msg' | 'reply' | 'failed'

/** «Пакет» сообщения, бегущий по ребру. */
export interface Packet {
	id: string
	from: string
	to: string
	tone: PacketTone
	start: number
	dur: number
	el: SVGGElement | null
	trail: SVGPathElement | null
}

/** Трансформация вида: экран = мир * k + (x, y). */
export interface Viewport {
	x: number
	y: number
	k: number
}

export interface Size {
	w: number
	h: number
}
