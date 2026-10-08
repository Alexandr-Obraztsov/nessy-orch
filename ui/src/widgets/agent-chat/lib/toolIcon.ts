import type { IconName } from '@/shared/ui'

/** Иконка инструмента по имени (shell → терминал, read/write → файл, grep → поиск…). */
export function toolIcon(name: string): IconName {
	const n = name.toLowerCase()
	if (/shell|bash|exec|command|terminal|run/.test(n)) return 'terminal'
	if (/grep|search|find|glob|query|list/.test(n)) return 'search'
	if (/read|write|edit|file|patch|create|replace/.test(n)) return 'file'
	if (/agent|task|spawn|delegate/.test(n)) return 'graph'
	if (/fetch|web|http|url/.test(n)) return 'bolt'
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
