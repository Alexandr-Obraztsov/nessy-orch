import type { IconName } from '@/shared/ui'

/** Иконка инструмента по имени (shell → терминал, read/write → файл, grep → поиск…). */
export function toolIcon(name: string): IconName {
	const n = name.toLowerCase()
	if (/shell|bash|exec|command|terminal|run/.test(n)) return 'terminal'
	if (/grep|search|find|glob|query|list/.test(n)) return 'search'
	if (/read|write|edit|file|patch|create|replace/.test(n)) return 'file'
	if (/agent|task|spawn|delegate/.test(n)) return 'graph'
	if (/fetch|web|http|url/.test(n)) return 'link'
	return 'tool'
}

/** Ввод инструмента в читаемом JSON. */
export function prettyJson(v: unknown): string {
	try {
		return JSON.stringify(v, null, 2)
	} catch {
		return String(v)
	}
}

/** «0.4 с», «12 с», «1:07». */
export function formatMs(ms: number): string {
	if (ms < 1000) return `${Math.max(0.1, Math.round(ms / 100) / 10)} с`
	const s = Math.round(ms / 1000)
	if (s < 60) return `${s} с`
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
