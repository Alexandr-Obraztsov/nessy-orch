/**
 * Построчный diff двух текстов (LCS) для показа правок Edit в стиле Claude Code:
 * « » — без изменений, «-» — удалено, «+» — добавлено. Большие тексты — без выравнивания.
 */
import type { DiffLine } from './diff.types'

const MAX_CELLS = 250_000

export function lineDiff(before: string, after: string): DiffLine[] {
	const a = before.split('\n')
	const b = after.split('\n')
	if (a.length * b.length > MAX_CELLS)
		return [...a.map((text): DiffLine => ({ op: '-', text })), ...b.map((text): DiffLine => ({ op: '+', text }))]
	const n = a.length
	const m = b.length
	// lcs[i][j] — длина общей подпоследовательности a[i..] и b[j..]
	const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
	for (let i = n - 1; i >= 0; i--) {
		const row = lcs[i] ?? []
		const next = lcs[i + 1] ?? []
		for (let j = m - 1; j >= 0; j--) row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0)
	}
	const out: DiffLine[] = []
	let i = 0
	let j = 0
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			out.push({ op: ' ', text: a[i] ?? '' })
			i++
			j++
		} else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) out.push({ op: '-', text: a[i++] ?? '' })
		else out.push({ op: '+', text: b[j++] ?? '' })
	}
	while (i < n) out.push({ op: '-', text: a[i++] ?? '' })
	while (j < m) out.push({ op: '+', text: b[j++] ?? '' })
	return out
}

/** Diff в текст unified-формата (для подсветки языком diff). Длинные неизменные участки сжимаются. */
export function diffText(lines: DiffLine[], context = 3): string {
	const keep = lines.map(() => false)
	lines.forEach((l, i) => {
		if (l.op === ' ') return
		for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true
	})
	const out: string[] = []
	let skipped = 0
	lines.forEach((l, i) => {
		if (!keep[i]) {
			skipped++
			return
		}
		if (skipped > 0) out.push(`@@ … ${skipped} без изменений @@`)
		skipped = 0
		out.push(`${l.op}${l.text}`)
	})
	if (skipped > 0 && out.length > 0) out.push(`@@ … ${skipped} без изменений @@`)
	return out.join('\n')
}
