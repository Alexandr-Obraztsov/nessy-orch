/** Поиск транскриптов Claude Code (`<dir>/<проект>/<чат>.jsonl`), в которых вызывался nessy-orch. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { BackfillCandidate } from '../../../shared/types'
import { isObject, parseJson } from '../../lib/json'

const CALL = /nessy-orch\s+(?:spawn|send)\b/
const CHUNK = 64 * 1024
const HEAD = 256 * 1024
const TITLE_MAX = 80
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

/** Есть ли в файле вызов `nessy-orch spawn|send`: чтение кусками до первого совпадения. */
function hasNessyCall(file: string): boolean {
	let fd: number
	try {
		fd = fs.openSync(file, 'r')
	} catch {
		return false
	}
	try {
		const buf = Buffer.alloc(CHUNK)
		let tail = ''
		for (;;) {
			const n = fs.readSync(fd, buf, 0, CHUNK, null)
			if (n <= 0) return false
			const text = tail + buf.toString('latin1', 0, n)
			if (CALL.test(text)) return true
			tail = text.slice(-32)
		}
	} catch {
		return false
	} finally {
		fs.closeSync(fd)
	}
}

/** Первая пользовательская строка начала файла (до 80 знаков). */
function firstUserLine(file: string): string {
	let head = ''
	try {
		const fd = fs.openSync(file, 'r')
		try {
			const buf = Buffer.alloc(HEAD)
			head = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, HEAD, 0))
		} finally {
			fs.closeSync(fd)
		}
	} catch {
		return ''
	}
	for (const line of head.split('\n')) {
		const r = parseJson(line)
		if (!isObject(r) || r['type'] !== 'user' || r['isMeta'] === true || r['isSidechain'] === true || !isObject(r['message'])) continue
		const c = r['message']['content']
		const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => (isObject(b) && b['type'] === 'text' && typeof b['text'] === 'string' ? b['text'] : '')).join('\n') : ''
		const first = text.replace(REMINDER, '').split('\n').map(l => l.trim()).find(Boolean)
		if (first) return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1)}…` : first
	}
	return ''
}

function transcriptFiles(dir: string): Array<{ file: string; id: string }> {
	let projects: string[] = []
	try {
		projects = fs.readdirSync(dir)
	} catch {
		return []
	}
	const out: Array<{ file: string; id: string }> = []
	for (const p of projects) {
		let names: string[] = []
		try {
			names = fs.readdirSync(path.join(dir, p))
		} catch {
			continue
		}
		for (const n of names) if (n.endsWith('.jsonl')) out.push({ file: path.join(dir, p, n), id: n.slice(0, -'.jsonl'.length) })
	}
	return out
}

/** Кандидаты разбора: транскрипты с вызовами nessy-orch, кроме чатов из `knownChatIds`; свежие первыми. */
export function scanTranscripts(dir: string, knownChatIds: ReadonlySet<string>): BackfillCandidate[] {
	const out: BackfillCandidate[] = []
	for (const { file, id } of transcriptFiles(dir)) {
		if (knownChatIds.has(id)) continue
		let st: fs.Stats
		try {
			st = fs.statSync(file)
		} catch {
			continue
		}
		if (!st.isFile() || !hasNessyCall(file)) continue
		out.push({ kind: 'transcript', id, title: firstUserLine(file), date: st.mtime.toISOString(), size: st.size })
	}
	return out.sort((a, b) => b.date.localeCompare(a.date))
}

/** Путь транскрипта по id чата. */
export function findTranscript(dir: string, chatId: string): string | null {
	return transcriptFiles(dir).find(f => f.id === chatId)?.file ?? null
}
