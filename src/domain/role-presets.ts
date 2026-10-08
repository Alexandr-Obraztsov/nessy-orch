/**
 * Пресеты ролей в markdown: строгий frontmatter (`---\nkey: value\n---\nтело`) + инструкции в теле.
 * Чистые функции: разбор, проверка полей и обратная запись (round-trip с `role export`).
 */
import { AppError } from './errors'
import type { RoleInput, RolePresetMeta } from './types'

const bad = (msg: string): AppError => new AppError(400, 'bad_preset', msg)

const KEY_RE = /^[A-Za-z][\w-]*$/

/** Значение: в кавычках ("…" с \" и \\ либо '…') или как есть (без пробелов по краям). */
function parseValue(raw: string, line: number): string {
	const v = raw.trim()
	const q = v[0]
	if (q !== '"' && q !== "'") return v
	if (v.length < 2 || v[v.length - 1] !== q) throw bad(`frontmatter, строка ${line}: незакрытая кавычка`)
	const inner = v.slice(1, -1)
	return q === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner
}

/**
 * Разобрать frontmatter. Файл должен начинаться с `---`; поля — `ключ: значение` по одному в строке
 * (пустые строки и `# комментарии` допустимы); блок закрывает строка `---`. Тело — всё после неё без изменений
 * (кроме переводов строк: CRLF → LF).
 */
export function parseFrontmatter(text: string): RolePresetMeta {
	const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
	const lines = src.split('\n')
	if (lines[0]?.trimEnd() !== '---') throw bad('файл должен начинаться со строки «---» (frontmatter)')
	const fields: Record<string, string> = {}
	let end = -1
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i] as string
		if (line.trimEnd() === '---') {
			end = i
			break
		}
		if (!line.trim() || line.trimStart().startsWith('#')) continue
		const colon = line.indexOf(':')
		const key = colon === -1 ? '' : line.slice(0, colon).trim()
		if (!KEY_RE.test(key)) throw bad(`frontmatter, строка ${i + 1}: ожидается «ключ: значение»`)
		if (key in fields) throw bad(`frontmatter, строка ${i + 1}: ключ «${key}» повторяется`)
		fields[key] = parseValue(line.slice(colon + 1), i + 1)
	}
	if (end === -1) throw bad('frontmatter не закрыт строкой «---»')
	return { fields, body: lines.slice(end + 1).join('\n') }
}

/** Пресет → поля роли для validateRole: обязательны id и name; color — число 0..360. */
export function parseRolePreset(text: string): RoleInput {
	const { fields, body } = parseFrontmatter(text)
	const id = fields['id']
	const name = fields['name']
	if (!id) throw bad('в frontmatter нет id')
	if (!name) throw bad('в frontmatter нет name')
	const input: RoleInput = { id, name, instructions: body, description: fields['description'] ?? '' }
	const color = fields['color']
	if (color !== undefined && color !== '') {
		const n = Number(color)
		if (!Number.isFinite(n) || n < 0 || n > 360) throw bad(`color «${color}» — число 0..360`)
		input.color = n
	}
	return input
}

function formatValue(v: string): string {
	return v === '' || /^[\s"'#]|\s$|[\\"\n\r]/.test(v) ? `"${v.replace(/[\\"]/g, '\\$&').replace(/\s*[\r\n]+\s*/g, ' ')}"` : v
}

/** Роль → текст пресета (обратное к parseRolePreset). */
export function formatRolePreset(role: { id: string; name: string; description: string; color: number; instructions: string }): string {
	const head = [`id: ${formatValue(role.id)}`, `name: ${formatValue(role.name)}`]
	if (role.description) head.push(`description: ${formatValue(role.description)}`)
	head.push(`color: ${role.color}`)
	return `---\n${head.join('\n')}\n---\n${role.instructions.replace(/\n*$/, '')}\n`
}
