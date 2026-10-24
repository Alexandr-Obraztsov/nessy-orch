import type { Message, SessionView } from '../../../shared/types'
import type { RawEvent } from '../../domain/learning.types'
import { parseTranscript } from '../../domain/transcript'
import { USER, YOU } from '../../domain/constants'
import { skillName } from '../../domain/playbook-render'
import type { CaseState, TranscriptCursor } from './learning.types'

/** Цепочка `/clear`: корень (на кого никто не указывает) → последняя по `successor`. Неизвестный id — одна эта сессия. */
export function chainOf(sessions: readonly SessionView[], id: string): string[] {
	const byId = new Map(sessions.map(s => [s.id, s]))
	const prev = new Map<string, string>()
	for (const s of sessions) if (s.successor) prev.set(s.successor, s.id)
	let root = id
	const seen = new Set<string>([id])
	for (let p = prev.get(root); p !== undefined && !seen.has(p); p = prev.get(root)) {
		seen.add(p)
		root = p
	}
	const chain = [root]
	const walked = new Set<string>(chain)
	for (let next = byId.get(root)?.successor; next && !walked.has(next); next = byId.get(next)?.successor) {
		walked.add(next)
		chain.push(next)
	}
	return chain
}

/** Префикс имени скилла плагина с плейбуками. */
const PLAYBOOK_PREFIX = 'nessy-playbooks:'

export const caseIdOf = (rootSessionId: string): string => `c-${rootSessionId}`

const isOperator = (from: string): boolean => from === YOU || from === USER

/** Сообщение ленты → событие: задание агенту (от оператора) или ответ агента; остальное (агент→агент, system, event) отбрасывается. */
function messageEvent(m: Message): Omit<RawEvent, 'n'> | null {
	if (m.kind === 'msg' && isOperator(m.from)) return { ts: m.ts, kind: 'task', from: m.from, to: m.to, text: m.text, ref: m.id }
	if (m.kind === 'reply' && !isOperator(m.from) && m.from !== 'system') return { ts: m.ts, kind: 'reply', from: m.from, to: m.to, text: m.text, ref: m.id }
	return null
}

/**
 * Новая порция событий кейса: сообщения ленты и записи транскриптов, по `ts`, нумерация с `c.nextN`.
 * `feedSeq` сдвигается до максимума просмотренных сообщений, даже отброшенных.
 */
export function ingest(
	c: CaseState,
	input: {
		messages: Message[]
		transcripts: Array<{ chatId: string; text: string; next: TranscriptCursor }>
		playbookVersion?: (id: string) => number | undefined
	},
): { events: RawEvent[]; state: CaseState } {
	const fresh: Array<Omit<RawEvent, 'n'>> = []
	let feedSeq = c.feedSeq
	for (const m of input.messages) {
		feedSeq = Math.max(feedSeq, m.seq)
		const e = messageEvent(m)
		if (e) fresh.push(e)
	}
	const transcripts = { ...c.transcripts }
	for (const t of input.transcripts) {
		transcripts[t.chatId] = t.next
		for (const e of parseTranscript(t.text, { nessyCalls: c.nessyCalls })) {
			fresh.push({ ts: e.ts, kind: e.kind, from: e.kind === 'user' ? USER : 'claude', to: null, text: e.text, ref: e.uuid })
		}
	}
	// сортировка устойчивая: при равных `ts` лента идёт раньше транскрипта
	fresh.sort((a, b) => a.ts - b.ts)
	const events = fresh.map((e, i) => ({ n: c.nextN + i, ...e }))
	const last = events.reduce((max, e) => Math.max(max, e.ts), c.lastEventAt)
	// первое обращение к скиллу плейбука в кейсе: `<id>@<версия>` (неизвестный плейбук — `@0`)
	let playbook = c.playbook
	if (playbook === null) {
		const hit = events.find(e => e.kind === 'skill' && e.text.startsWith(PLAYBOOK_PREFIX))
		if (hit) {
			const id = skillName(hit.text.slice(PLAYBOOK_PREFIX.length))
			playbook = `${id}@${input.playbookVersion?.(id) ?? 0}`
		}
	}
	const state: CaseState = { ...c, feedSeq, transcripts, nextN: c.nextN + events.length, events: c.events + events.length, lastEventAt: last, playbook }
	return { events, state }
}
