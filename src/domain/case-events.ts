import type { Portion, RawEvent, RawKind } from './learning.types'

/** Лимиты текста события по видам (знаков). */
const LIMITS: Record<Exclude<RawKind, 'reply'>, number> = { user: 4000, claude: 3000, task: 2000, call: 2000 }

/** Заголовок раздела: `**Итог**`, `**Итог:**` или `## Итог` на отдельной строке. */
const HEADING = /^\s*(?:\*\*(.+?)\*\*:?|#{1,6}\s+(.+?))\s*$/
const KEEP = /^(итог|источники|result|summary|sources)(?![\p{L}\d_])/iu
const STATUS = /^\s*(?:статус|status)\s*:/i

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text)

/**
 * Сжатие ответа агента: остаются «Итог», «Источники» и строка статуса, остальное выброшено.
 * Ответ без разделов — первые `max` знаков.
 */
export function condenseReply(text: string, max = 1500): string {
	const lines = text.split('\n')
	const status: string[] = []
	const sections: { keep: boolean; lines: string[] }[] = []
	let current: { keep: boolean; lines: string[] } | null = null
	for (const line of lines) {
		if (STATUS.test(line)) {
			status.push(line.trim())
			continue
		}
		const m = HEADING.exec(line)
		if (m) {
			const title = (m[1] ?? m[2] ?? '').trim()
			current = { keep: KEEP.test(title), lines: [line.trimEnd()] }
			sections.push(current)
		} else if (current) {
			current.lines.push(line.trimEnd())
		}
	}
	const kept = sections.filter(s => s.keep).map(s => s.lines.join('\n').trim())
	if (!sections.length || (!kept.length && !status.length)) return clip(text.trim(), max)
	return [...kept, ...status].join('\n\n')
}

function eventText(e: RawEvent): string {
	return e.kind === 'reply' ? condenseReply(e.text) : clip(e.text, LIMITS[e.kind])
}

/** Порция событий для сборщика: строки `[n] kind from→to: text` до `maxChars`, но не меньше одного события. */
export function renderPortion(events: readonly RawEvent[], maxChars: number): Portion {
	const lines: string[] = []
	let length = 0
	let from = 0
	let until = 0
	for (const e of events) {
		const route = e.to ? `${e.from}→${e.to}` : e.from
		const line = `[${e.n}] ${e.kind} ${route}: ${eventText(e)}`
		const next = length + (lines.length ? 1 : 0) + line.length
		if (lines.length && next > maxChars) break
		if (!lines.length) from = e.n
		lines.push(line)
		until = e.n
		length = next
	}
	return { text: lines.join('\n'), from, until }
}
