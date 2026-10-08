import type { AgentView } from '@contract'

/** Значение селекта «Другой путь…». */
export const OTHER_PATH = '__path'

const NAME_OK = /^[\p{L}\p{N}_.-]+$/u

/** Ошибка имени (блокирует отправку) — только если имя уже занято. */
export function nameError(name: string, agents: AgentView[]): string | null {
	const n = name.trim().toLowerCase()
	if (!n) return null
	return agents.some(a => a.name.toLowerCase() === n) ? 'Это имя уже занято другим агентом' : null
}

/** Мягкая подсказка по имени: пробелы и спецсимволы неудобны в CLI. */
export function nameWarning(name: string): string | null {
	const n = name.trim()
	if (!n || NAME_OK.test(n)) return null
	return 'Лучше без пробелов: буквы, цифры, «-» и «_» — так удобнее обращаться из CLI'
}

export function pathError(path: string): string | null {
	const p = path.trim()
	if (!p) return 'Укажите путь к рабочей папке'
	if (!p.startsWith('/') && !p.startsWith('~')) return 'Нужен абсолютный путь, например /Users/me/project'
	return null
}

/** Имя по умолчанию от роли: «Code reviewer» → «code-reviewer», при занятости — «-2», «-3»… */
export function suggestName(roleName: string, agents: AgentView[]): string {
	const base =
		roleName
			.trim()
			.toLowerCase()
			.replace(/[^\p{L}\p{N}_-]+/gu, '-')
			.replace(/^-+|-+$/g, '') || 'agent'
	const taken = new Set(agents.map(a => a.name.toLowerCase()))
	if (!taken.has(base)) return base
	for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
}
