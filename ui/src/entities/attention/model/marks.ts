/**
 * Отметки «просмотрено» / «готово» для результатов. Живут в localStorage (по msgId),
 * чтобы переживать перезагрузку; подписка из React — useMarks().
 */
import { useSyncExternalStore } from 'react'
import type { AttentionMarks } from './types'

const KEY = 'nessy-orch:attention-v1'
const LIMIT = 400

function startOfToday(): number {
	const d = new Date()
	d.setHours(0, 0, 0, 0)
	return d.getTime()
}

function load(): AttentionMarks {
	try {
		const raw = localStorage.getItem(KEY)
		if (raw) {
			const v = JSON.parse(raw) as Partial<AttentionMarks>
			return {
				since: typeof v.since === 'number' ? v.since : startOfToday(),
				seen: Array.isArray(v.seen) ? v.seen.filter(x => typeof x === 'string') : [],
				done: Array.isArray(v.done) ? v.done.filter(x => typeof x === 'string') : [],
			}
		}
	} catch {
		/* битые данные — начинаем заново */
	}
	// первый запуск: показываем только сегодняшние результаты
	return { since: startOfToday(), seen: [], done: [] }
}

let marks: AttentionMarks = load()
const listeners = new Set<() => void>()

function save(next: AttentionMarks): void {
	marks = next
	try {
		localStorage.setItem(KEY, JSON.stringify(marks))
	} catch {
		/* приватный режим — отметки живут до перезагрузки */
	}
	for (const fn of listeners) fn()
}

const add = (list: string[], id: string): string[] => (list.includes(id) ? list : [...list, id].slice(-LIMIT))

/** Ответ просмотрен (открыли агента): элемент остаётся, но уже не жирный. */
export function markSeen(msgId: string): void {
	if (marks.seen.includes(msgId)) return
	save({ ...marks, seen: add(marks.seen, msgId) })
}

/** Ответ обработан («Готово»): элемент исчезает из «Внимания». */
export function markDone(msgId: string): void {
	if (marks.done.includes(msgId)) return
	save({ ...marks, seen: add(marks.seen, msgId), done: add(marks.done, msgId) })
}

export function getMarks(): AttentionMarks {
	return marks
}

export function useMarks(): AttentionMarks {
	return useSyncExternalStore(
		fn => {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
		() => marks,
	)
}
