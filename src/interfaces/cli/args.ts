/** Минимальный парсер аргументов CLI (без зависимостей). */
import type { FlagSpec, Parsed } from './args.types'
import { CliError } from './errors'

export function parseArgs(argv: readonly string[], spec: FlagSpec): Parsed {
	const positionals: string[] = []
	const flags = new Map<string, string | true>()
	const valueFlags = new Set(spec.value ?? [])
	const boolFlags = new Set(spec.bool ?? [])
	let rest = false
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i] as string
		// «- [x] шаг» — пункт чек-листа (nessy-orch plan), а не флаг: после дефиса пробел
		if (rest || !a.startsWith('-') || a === '-' || /^-\s/.test(a)) {
			positionals.push(a)
			continue
		}
		if (a === '--') {
			rest = true
			continue
		}
		let name: string
		let inline: string | undefined
		if (a.startsWith('--')) {
			const eq = a.indexOf('=')
			name = eq === -1 ? a.slice(2) : a.slice(2, eq)
			inline = eq === -1 ? undefined : a.slice(eq + 1)
		} else {
			name = spec.short?.[a.slice(1)] ?? a.slice(1)
		}
		if (valueFlags.has(name)) {
			const v = inline ?? argv[++i]
			if (v === undefined) throw new CliError(`флаг --${name} требует значение`, 2)
			flags.set(name, v)
		} else if (boolFlags.has(name)) {
			if (inline === undefined || inline !== 'false') flags.set(name, true)
		} else {
			throw new CliError(`неизвестный флаг: ${a}`, 2)
		}
	}
	return { positionals, flags }
}

export const flagStr = (p: Parsed, name: string): string | undefined => {
	const v = p.flags.get(name)
	return typeof v === 'string' ? v : undefined
}
export const flagBool = (p: Parsed, name: string): boolean => p.flags.get(name) === true
export const flagNum = (p: Parsed, name: string): number | undefined => {
	const v = flagStr(p, name)
	if (v === undefined) return undefined
	const n = Number(v)
	if (!Number.isFinite(n)) throw new CliError(`--${name} должен быть числом`, 2)
	return n
}
