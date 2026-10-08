/**
 * Вывод инструмента: rawOutput + content[] с дедупликацией
 * (как buildToolOutput в docs/contract/reference/vscode-acp-agent/acpSessionUpdateAdapter.ts).
 */
import { isObject, obj, str } from '../../lib/json'

export function stringifyUnknown(value: unknown): string {
	if (value === undefined || value === null) return ''
	if (typeof value === 'string') return value
	try {
		return JSON.stringify(value, undefined, 2)
	} catch {
		return Object.prototype.toString.call(value) // циклические структуры, BigInt
	}
}

/** Текст одного элемента content[]: content → текст, diff → diff-текст, terminal → `Terminal: <id>`. */
export function extractToolContent(item: unknown): string {
	if (!isObject(item)) return ''
	switch (item['type']) {
		case 'content': {
			const c = obj(item['content'])
			return c['type'] === 'text' ? str(c['text']) : stringifyUnknown(item['content'])
		}
		case 'diff': {
			const parts = [`Diff: ${str(item['path'])}`]
			if (typeof item['oldText'] === 'string') parts.push('--- old', item['oldText'])
			parts.push('+++ new', str(item['newText']))
			return parts.join('\n')
		}
		case 'terminal':
			return `Terminal: ${str(item['terminalId'])}`
		default:
			return ''
	}
}

/** Собрать вывод: части, целиком содержащиеся в более длинной части, выбрасываются. */
export function buildToolOutput(rawOutput: unknown, content: readonly unknown[]): string {
	const parts = [
		{ value: stringifyUnknown(rawOutput), dedup: true },
		...content.map(c => ({ value: extractToolContent(c), dedup: isObject(c) && c['type'] === 'content' })),
	].filter(p => p.value.trim().length > 0)

	const kept = parts.filter((cand, ci) => {
		if (!cand.dedup) return true
		const v = cand.value.trim()
		return !parts.some((other, oi) => {
			if (!other.dedup || oi === ci) return false
			const o = other.value.trim()
			const otherWins = o.length > v.length || (o.length === v.length && oi < ci)
			return otherWins && o.includes(v)
		})
	})
	return kept.map(p => p.value).join('\n\n')
}
