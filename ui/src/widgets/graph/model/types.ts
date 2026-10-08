import type { SimulationNodeDatum } from 'd3-force'

/** Узел для отрисовки. */
export interface GNode {
	id: string
	name: string
	you: boolean
	/** hue роли; null — без роли */
	roleHue: number | null
	working: boolean
	error: boolean
	archived: boolean
	/** сообщений с участием узла — от этого зависит размер */
	weight: number
	r: number
}

export type EdgeKind = 'parent' | 'comm'

/** Ребро: пара узлов (без направления), parent имеет приоритет над перепиской. */
export interface GEdge {
	id: string
	kind: EdgeKind
	a: string
	b: string
}

export interface GraphData {
	nodes: GNode[]
	edges: GEdge[]
	/** сколько агентов в архиве (для переключателя) */
	archived: number
}

export interface GraphSettings {
	showArchived: boolean
	/** подписи всегда (иначе — при приближении и наведении) */
	labels: boolean
}

/** Узел симуляции d3-force. */
export interface SimNode extends SimulationNodeDatum {
	id: string
	r: number
}

export interface SimLink {
	source: string | SimNode
	target: string | SimNode
	kind: EdgeKind
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
