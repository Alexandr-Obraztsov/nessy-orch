/**
 * Раскрытие инструмента: что было на входе (команда, diff правки, содержимое файла, аргументы)
 * и что вернулось (вывод с подсветкой по типу файла), плюс краткий итог для строки.
 */
import type { ToolEvent } from '@contract'
import { toolView } from '@/entities/agent'
import { diffText, lineDiff } from '@/shared/lib/diff'
import { langFromPath } from '@/shared/lib/highlight'
import { plural } from '@/shared/lib/plural'
import type { ToolDetail } from '../model/types'

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function pick(input: Record<string, unknown>, keys: string[]): string | null {
	for (const k of keys) {
		const v = str(input[k])
		if (v !== null) return v
	}
	return null
}

const OLD = ['old_string', 'old_str', 'oldText', 'old_text', 'old']
const NEW = ['new_string', 'new_str', 'newText', 'new_text', 'new']
const PATH = ['file_path', 'absolute_path', 'path', 'filePath']

/** Пары «было → стало» из входа правки (одиночной или edits[]). */
function editPairs(input: Record<string, unknown>): Array<[string, string]> {
	const one = pick(input, NEW)
	if (one !== null) return [[pick(input, OLD) ?? '', one]]
	const edits = input['edits']
	if (!Array.isArray(edits)) return []
	const out: Array<[string, string]> = []
	for (const e of edits) {
		if (typeof e !== 'object' || e === null) continue
		const rec = e as Record<string, unknown>
		const n = pick(rec, NEW)
		if (n !== null) out.push([pick(rec, OLD) ?? '', n])
	}
	return out
}

/** Вывод «Diff: путь / --- old / … / +++ new / …» (так сервер склеивает diff-контент ACP). */
const DIFF_OUT = /^Diff: (.*)\n(?:--- old\n([\s\S]*?)\n)?\+\+\+ new\n([\s\S]*)$/

function diffStats(text: string): { add: number; del: number } {
	let add = 0
	let del = 0
	for (const l of text.split('\n')) {
		if (l.startsWith('+')) add++
		else if (l.startsWith('-')) del++
	}
	return { add, del }
}

function withoutKeys(input: Record<string, unknown>, keys: string[]): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(input)) if (!keys.includes(k)) out[k] = v
	return out
}

export function toolDetail(ev: ToolEvent): ToolDetail {
	const view = toolView(ev)
	const input = ev.input
	const path = pick(input, PATH)
	const output = (ev.output ?? '').replace(/\s+$/, '')
	let inBlock: ToolDetail['input'] = null
	let outBlock: ToolDetail['output'] = null
	let summary = ''

	const command = pick(input, ['command', 'cmd'])
	const pairs = editPairs(input)
	const content = str(input['content'])
	const diffOut = DIFF_OUT.exec(output)

	if (command !== null) inBlock = { code: `$ ${command}`, lang: 'bash', label: 'команда' }
	else if (pairs.length > 0) {
		const text = pairs.map(([a, b]) => diffText(lineDiff(a, b))).join('\n@@ @@\n')
		const st = diffStats(text)
		summary = `+${st.add} −${st.del}`
		inBlock = { code: text, lang: 'diff', label: path ?? 'правка' }
	} else if (content !== null && path) {
		inBlock = { code: content, lang: langFromPath(path), label: path }
		summary = plural(content.split('\n').length, 'строка', 'строки', 'строк')
	} else {
		const rest = withoutKeys(input, view.arg ? [...PATH, 'pattern', 'query', 'url', 'step'] : [])
		if (Object.keys(rest).length > 0) inBlock = { code: JSON.stringify(rest, null, 2), lang: 'json', label: 'аргументы' }
	}

	if (output) {
		if (diffOut && pairs.length === 0) {
			const text = diffText(lineDiff(diffOut[2] ?? '', diffOut[3] ?? ''))
			const st = diffStats(text)
			summary = `+${st.add} −${st.del}`
			outBlock = { code: text, lang: 'diff', label: diffOut[1] ?? 'diff' }
		} else if (!diffOut) {
			const lang = view.name === 'Read' && path ? langFromPath(path) : /^\s*[[{]/.test(output) ? 'auto' : null
			outBlock = { code: output, lang, label: 'вывод' }
		}
	}

	const exit = /exit(?:ed with)?(?: code| status)?[:=\s]+(-?\d+)/i.exec(output)?.[1]
	if (ev.status === 'failed') summary = exit && exit !== '0' ? `exit ${exit}` : 'ошибка'
	else if (ev.status !== 'completed') summary = ''
	else if (exit && exit !== '0') summary = `exit ${exit}`
	else if (!summary && outBlock) summary = plural(output.split('\n').length, 'строка', 'строки', 'строк')
	return { input: inBlock, output: outBlock, summary }
}
