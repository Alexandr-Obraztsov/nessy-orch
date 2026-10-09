/**
 * Инструмент в стиле Claude Code: короткое имя (Bash, Read, Edit…) и главный аргумент
 * (команда, путь, шаблон, URL). Имена nessy (run_shell_command, read_file, MCP `server|tool`)
 * приводятся к привычным; аргумент — из входа вызова, иначе из заголовка «Shell: npm test».
 */
import type { ToolView } from './state.types'

const NAMES: Record<string, string> = {
	run_shell_command: 'Bash',
	shell: 'Bash',
	bash: 'Bash',
	execute: 'Bash',
	terminal: 'Bash',
	read_file: 'Read',
	read_many_files: 'Read',
	read: 'Read',
	write_file: 'Write',
	write: 'Write',
	create_file: 'Write',
	replace: 'Edit',
	edit: 'Edit',
	edit_file: 'Edit',
	multi_edit: 'Edit',
	glob: 'Glob',
	search_file_content: 'Grep',
	grep: 'Grep',
	search: 'Grep',
	list_directory: 'LS',
	ls: 'LS',
	web_fetch: 'WebFetch',
	fetch: 'WebFetch',
	google_web_search: 'WebSearch',
	web_search: 'WebSearch',
	think: 'Think',
	todo_write: 'TodoWrite',
	save_memory: 'Memory',
}

/** Ключи входа по приоритету: что показать рядом с именем. */
const ARG_KEYS = ['command', 'cmd', 'file_path', 'absolute_path', 'path', 'paths', 'pattern', 'query', 'url', 'prompt', 'step', 'description']

function prettyName(raw: string): string {
	const n = raw.trim()
	const known = NAMES[n.toLowerCase()]
	if (known) return known
	// MCP: «gitlab|get_merge_request», «gitlab.get_mr», «mcp__gitlab__get_mr»
	const mcp = /^(?:mcp__)?([\w-]+?)(?:__|\||\.)([\w.-]+)$/.exec(n)
	if (mcp) return `${mcp[1] ?? ''} · ${mcp[2] ?? ''}`
	return n
}

function argFromInput(input: Record<string, unknown> | undefined): string {
	if (!input) return ''
	for (const k of ARG_KEYS) {
		const v = input[k]
		if (typeof v === 'string' && v.trim()) return v.trim()
		if (Array.isArray(v) && v.length > 0) return v.filter((x): x is string => typeof x === 'string').join(' ')
	}
	return ''
}

/** Первая строка, без лишних пробелов. */
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

export function toolView(t: { name: string; title: string; input?: Record<string, unknown> }): ToolView {
	const title = t.title.trim()
	const i = title.indexOf(': ')
	const fromTitle = i > 0 && i <= 24 ? { name: title.slice(0, i), arg: title.slice(i + 2) } : null
	// имя: из имени инструмента; если оно служебное («tool», kind) — из заголовка
	const generic = !t.name || t.name === 'tool' || t.name === 'other'
	const name = prettyName(generic ? (fromTitle?.name ?? (title || 'Tool')) : t.name)
	const titleName = fromTitle ? prettyName(fromTitle.name) : ''
	const arg = argFromInput(t.input) || fromTitle?.arg || (title && title !== t.name && titleName !== name ? title : '')
	return { name, arg: oneLine(arg) }
}
