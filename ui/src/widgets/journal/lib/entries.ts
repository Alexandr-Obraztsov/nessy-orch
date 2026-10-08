/**
 * Журнал: сообщения ленты → записи с типом (сообщение / ответ / ошибка / служебное) и фильтры.
 */
import type { Message } from '@contract'
import type { JournalEntry, JournalFilter, JournalType } from '../model/types'

const SPECIAL = new Set(['you', 'system'])
const ERROR_RE = /ошибк|сбой|упал|не доставлено|failed|error/i

export function entryType(m: Message): JournalType {
	if (m.failed) return 'error'
	if (m.kind === 'event') return ERROR_RE.test(m.text) ? 'error' : 'system'
	return m.kind === 'reply' ? 'reply' : 'msg'
}

export function toEntry(m: Message): JournalEntry {
	const agentId = !SPECIAL.has(m.from) ? m.from : !SPECIAL.has(m.to) ? m.to : null
	const text = m.failed && !m.text.includes(m.failed) ? `${m.text} — ${m.failed}` : m.text
	return { id: m.id, seq: m.seq, ts: m.ts, type: entryType(m), from: m.from, to: m.to, text, agentId }
}

export function matchesEntry(e: JournalEntry, f: JournalFilter, label: (id: string) => string): boolean {
	if (f.type !== 'all' && e.type !== f.type) return false
	if (f.agent && e.from !== f.agent && e.to !== f.agent) return false
	if (f.task && !f.task.has(e.from) && !f.task.has(e.to)) return false
	const q = f.query.trim().toLowerCase()
	if (q && !`${label(e.from)} ${label(e.to)} ${e.text}`.toLowerCase().includes(q)) return false
	return true
}

/** Одна строка текста для ленты-тикера. */
export const oneLine = (text: string, max = 160): string => {
	const t = text.replace(/\s+/g, ' ').trim()
	return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
