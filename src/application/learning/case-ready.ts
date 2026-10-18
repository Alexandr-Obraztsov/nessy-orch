import type { CaseReadyHost } from './handlers.types'

type Payload = Record<string, unknown> | null

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Сводит `payload` ждущего `match` с новым: `caseIds` и `after` объединяются без дублей. */
export function mergeMatchPayload(a: Payload, b: Payload): Payload {
	const caseIds = [...new Set([...strings(a?.['caseIds']), ...strings(b?.['caseIds'])])]
	const after = [...new Set([...strings(a?.['after']), ...strings(b?.['after'])])]
	return after.length ? { caseIds, after } : { caseIds }
}

/**
 * Кейс окончательно стал `ready` (в том числе после бэкфилла): с плейбуком — ставится `judge`,
 * затем `match` по всем кейсам (один ждущий `match` на всех). Кейсы пачки бэкфилла ждут друг друга
 * через `payload.after`, чтобы сопоставитель запустился один раз после всей пачки.
 */
export function onCaseReady(host: CaseReadyHost, caseId: string): void {
	const c = host.cases.get(caseId)
	if (!c) return
	if (c.playbook) host.enqueue('judge', caseId, { caseId })
	const batch = host.batch(caseId)
	const payload: Record<string, unknown> = batch ? { caseIds: [caseId], after: batch } : { caseIds: [caseId] }
	host.enqueue('match', 'all', { payload, merge: mergeMatchPayload })
}
