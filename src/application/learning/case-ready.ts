import type { CaseReadyHost, JobPayload as Payload } from './handlers.types'

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Сводит `payload` ждущего `match` с новым: `caseIds` объединяются без дублей. */
export function mergeMatchPayload(a: Payload, b: Payload): Payload {
	return { caseIds: [...new Set([...strings(a?.['caseIds']), ...strings(b?.['caseIds'])])] }
}

/** Кейс окончательно стал `ready`: с плейбуком — ставится `judge`, затем `match` по всем кейсам (один ждущий `match` на всех). */
export function onCaseReady(host: CaseReadyHost, caseId: string): void {
	const c = host.cases.get(caseId)
	if (!c) return
	// замок плейбука читает `payload.playbookId`: id — часть `case.playbook` до `@`
	if (c.playbook) host.enqueue('judge', `judge:${caseId}`, { caseId, payload: { playbookId: c.playbook.split('@')[0] ?? '' } })
	host.enqueue('match', 'all', { payload: { caseIds: [caseId] }, merge: mergeMatchPayload })
}
