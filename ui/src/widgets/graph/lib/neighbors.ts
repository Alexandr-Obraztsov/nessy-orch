import type { EdgeDatum } from '../model/types'

/** Соседи узла по рёбрам (включая сам узел). */
export function neighborsOf(id: string | null, edges: EdgeDatum[]): Set<string> {
	const out = new Set<string>()
	if (!id) return out
	out.add(id)
	for (const e of edges) {
		if (e.a === id) out.add(e.b)
		else if (e.b === id) out.add(e.a)
	}
	return out
}
