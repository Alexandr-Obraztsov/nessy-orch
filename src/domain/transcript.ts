import type { TranscriptEntry } from './learning.types'

/** Вызов оркестратора, который попадает в запись `call`. */
const NESSY_CALL = /\bnessy-orch\s+(spawn|send|wait)\b/
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

type Block = Record<string, unknown>

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Текст из content: строка или text-блоки, склеенные `\n`. */
function blocksText(content: unknown): string {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	const parts: string[] = []
	for (const b of content) if (isObject(b) && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
	return parts.join('\n')
}

function blockList(content: unknown): Block[] {
	return Array.isArray(content) ? content.filter(isObject) : []
}

/**
 * Разбор транскрипта Claude Code (jsonl) в ленту записей.
 * Весь знаток формата — здесь: остальной код видит только `TranscriptEntry`.
 */
export function parseTranscript(text: string, opts: { nessyCalls: boolean }): TranscriptEntry[] {
	const records: Record<string, unknown>[] = []
	for (const line of text.split('\n')) {
		if (!line.trim()) continue
		try {
			const r: unknown = JSON.parse(line)
			if (isObject(r)) records.push(r)
		} catch {
			// битая строка (например, недописанная в конце) — пропуск
		}
	}
	const visible = records.filter(r => (r.type === 'user' || r.type === 'assistant') && r.isSidechain !== true && r.isMeta !== true && isObject(r.message))

	// результаты инструментов по tool_use_id (приходят в более поздних записях)
	const results = new Map<string, string>()
	if (opts.nessyCalls) {
		for (const r of visible) {
			if (r.type !== 'user' || !isObject(r.message)) continue
			for (const b of blockList(r.message.content)) {
				if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') results.set(b.tool_use_id, blocksText(b.content))
			}
		}
	}

	const out: TranscriptEntry[] = []
	for (const r of visible) {
		if (!isObject(r.message)) continue
		const uuid = typeof r.uuid === 'string' ? r.uuid : ''
		const parsed = typeof r.timestamp === 'string' ? Date.parse(r.timestamp) : NaN
		const ts = Number.isNaN(parsed) ? 0 : parsed
		const content = r.message.content
		if (r.type === 'user') {
			const t = blocksText(content).replace(REMINDER, '').trim()
			if (t) out.push({ uuid, ts, kind: 'user', text: t })
			continue
		}
		const t = blocksText(content).trim()
		if (t) out.push({ uuid, ts, kind: 'claude', text: t })
		if (!opts.nessyCalls) continue
		for (const b of blockList(content)) {
			if (b.type !== 'tool_use' || b.name !== 'Bash' || typeof b.id !== 'string' || !isObject(b.input)) continue
			const command = b.input.command
			if (typeof command !== 'string' || !NESSY_CALL.test(command)) continue
			const result = (results.get(b.id) ?? '').trim()
			out.push({ uuid: `${uuid}:${b.id}`, ts, kind: 'call', text: result ? `$ ${command}\n${result}` : `$ ${command}` })
		}
	}
	return out
}
