import type { Range } from './playbook.types'

/** Якорь `n 12–15`, `n 12-15` или `n 12` → диапазон; иначе `null`. */
export function parseAnchor(a: string): Range | null {
	const m = /^\s*\(?\s*n\s*(\d+)(?:\s*[–—-]\s*(\d+))?\s*\)?\s*$/i.exec(a)
	if (!m) return null
	const from = Number(m[1])
	const to = m[2] === undefined ? from : Number(m[2])
	if (to < from) return null
	return { from, to }
}

/** Диапазоны с отступом `pad` (нижняя граница ≥ 1), слипшиеся и пересекающиеся объединены, по возрастанию. */
export function mergeRanges(rs: ReadonlyArray<Range>, pad: number): Range[] {
	const padded = rs.map(r => ({ from: Math.max(1, r.from - pad), to: r.to + pad })).sort((a, b) => a.from - b.from)
	const out: Range[] = []
	for (const r of padded) {
		const last = out[out.length - 1]
		if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to)
		else out.push({ ...r })
	}
	return out
}
