/**
 * «Внимание» из агентов и отметок (чистая функция):
 *   разрешения — агент заблокирован; ошибки — ход упал; результаты — ответ вам, ещё не отмеченный «Готово».
 * Разрешения и ошибки исчезают сами, когда ситуация разрешилась.
 */
import type { AgentView } from '@contract'
import type { AttentionItem, AttentionList, AttentionMarks } from '../model/types'

const time = (iso: string): number => {
	const t = Date.parse(iso)
	return Number.isNaN(t) ? 0 : t
}

export function deriveAttention(agents: AgentView[], marks: AttentionMarks): AttentionList {
	const permissions: AttentionItem[] = []
	const errors: AttentionItem[] = []
	const results: AttentionItem[] = []
	const seen = new Set(marks.seen)
	const done = new Set(marks.done)
	for (const a of agents) {
		if (a.pendingPermissions.length > 0) {
			for (const p of a.pendingPermissions)
				permissions.push({
					key: `perm:${a.id}:${p.requestId}`,
					kind: 'permission',
					agent: a,
					requestId: p.requestId,
					text: p.title,
					ts: time(a.lastActivityAt),
					unread: true,
				})
			continue
		}
		if (a.status === 'error') {
			errors.push({
				key: `err:${a.id}:${a.lastActivityAt}`,
				kind: 'error',
				agent: a,
				text: a.error ?? a.lastReply?.failed ?? 'ход завершился ошибкой',
				ts: time(a.lastActivityAt),
				unread: true,
			})
			continue
		}
		const r = a.lastReply
		if (r && !r.failed && r.ts >= marks.since && !done.has(r.msgId))
			results.push({ key: `res:${r.msgId}`, kind: 'result', agent: a, text: r.preview, ts: r.ts, msgId: r.msgId, unread: !seen.has(r.msgId) })
	}
	// свежие сверху
	const byTs = (x: AttentionItem, y: AttentionItem): number => y.ts - x.ts
	permissions.sort(byTs)
	errors.sort(byTs)
	results.sort(byTs)
	return { permissions, errors, results, total: permissions.length + errors.length + results.length }
}

/** Заголовок вкладки браузера: «(3) nessy-orch». */
export function attentionTitle(count: number, base = 'nessy-orch'): string {
	return count > 0 ? `(${count}) ${base}` : base
}
