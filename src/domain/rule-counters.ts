import type { Evidence, PlaybookView, RuleStatus, RuleView } from '../../shared/types'
import { parseAnchor } from './anchors'
import type { RuleVerdict, WithVerdicts } from './playbook.types'

const WEEK_MS = 7 * 24 * 3600 * 1000
/** Начальное ▲ нового правила. */
const BASE_UP = 2

function distinctCases(evidence: readonly Evidence[]): number {
	return new Set(evidence.map(e => e.caseId)).size
}

/**
 * Счётчики правила по вердиктам. `up = 2 + applied − floor(недель без применения / 8)`, `down = violated`.
 * Вердикты без времени: момент последнего применения хранится в `lastAppliedAt` правила.
 */
export function ruleCounters(
	r: { evidence: Evidence[]; createdAt: string; lastAppliedAt?: string | null },
	verdicts: readonly RuleVerdict[],
	now: number,
): { up: number; down: number; lastAppliedAt: string | null; status: RuleStatus } {
	const applied = verdicts.filter(v => v.verdict === 'applied').length
	const down = verdicts.filter(v => v.verdict === 'violated_by_user_correction').length
	const lastAppliedAt = r.lastAppliedAt ?? null
	const last = Math.max(Date.parse(r.createdAt) || 0, lastAppliedAt ? Date.parse(lastAppliedAt) || 0 : 0)
	const decay = Math.max(0, Math.floor((now - last) / (8 * WEEK_MS)))
	const up = Math.max(0, BASE_UP + applied - decay)
	let status: RuleStatus = 'candidate'
	if (up - down <= 0) status = 'archived'
	else if (distinctCases(r.evidence) >= 2 && down === 0) status = 'active'
	return { up, down, lastAppliedAt, status }
}

function key(e: Evidence): string {
	return `${e.caseId}|${e.anchor}`
}

/**
 * Вердикты кейса `caseId` заменяют прежние (повторно закрытый кейс не удваивает счётчики);
 * счётчики и доказательства правил пересчитываются по всем кейсам.
 */
export function applyVerdicts<T extends WithVerdicts>(p: T, caseId: string, rawVerdicts: RuleVerdict[], now: number): T {
	// поправка без разбираемого якоря не доказана: считается как not_applicable
	const verdicts = rawVerdicts.map(v =>
		v.verdict === 'violated_by_user_correction' && (v.anchor === null || parseAnchor(v.anchor) === null) ? { ...v, verdict: 'not_applicable' as const } : v,
	)
	const prev = p.verdicts[caseId] ?? []
	const all: Record<string, RuleVerdict[]> = { ...p.verdicts, [caseId]: verdicts }
	const iso = new Date(now).toISOString()
	const rules: RuleView[] = p.rules.map(r => {
		const mine = (id: string, list: readonly RuleVerdict[]): RuleVerdict[] => list.filter(v => v.ruleId === id)
		const before = mine(r.id, prev)
		const current = mine(r.id, verdicts)
		const applied = current.find(v => v.verdict === 'applied')
		const violated = current.find(v => v.verdict === 'violated_by_user_correction')
		// доказательства прежнего вердикта этого кейса снимаются, новые добавляются
		const drop = new Set(before.filter(v => v.anchor).map(v => key({ caseId, anchor: v.anchor ?? '' })))
		const evidence = r.evidence.filter(e => !(e.caseId === caseId && drop.has(key(e))))
		const against = r.against.filter(e => !(e.caseId === caseId && drop.has(key(e))))
		if (applied?.anchor && !evidence.some(e => key(e) === key({ caseId, anchor: applied.anchor ?? '' }))) evidence.push({ caseId, anchor: applied.anchor })
		if (violated?.anchor && !against.some(e => key(e) === key({ caseId, anchor: violated.anchor ?? '' }))) against.push({ caseId, anchor: violated.anchor })
		const lastAppliedAt = applied ? iso : r.lastAppliedAt
		const own = Object.values(all).flatMap(list => mine(r.id, list))
		const c = ruleCounters({ evidence, createdAt: r.createdAt, lastAppliedAt }, own, now)
		// активное правило не понижается до кандидата: счётчик лишь отправляет его в архив
		const status: RuleStatus = r.status === 'archived' ? 'archived' : c.status === 'archived' ? 'archived' : r.status
		return { ...r, evidence, against, up: c.up, down: c.down, lastAppliedAt: c.lastAppliedAt ?? lastAppliedAt, status }
	})
	return { ...p, verdicts: all, rules }
}

/** Кандидат становится активным: ≥ 2 разных **существующих** кейса «за» с разбираемыми якорями и ни одного «против». */
export function promoteCandidates<T extends PlaybookView>(p: T, knownCases: ReadonlySet<string>): T {
	const good = (evidence: readonly Evidence[]): number => distinctCases(evidence.filter(e => knownCases.has(e.caseId) && parseAnchor(e.anchor) !== null))
	const rules = p.rules.map(r => (r.status === 'candidate' && good(r.evidence) >= 2 && r.against.length === 0 ? { ...r, status: 'active' as const } : r))
	return { ...p, rules }
}

/**
 * Пересчёт счётчиков и архива всех правил без новых вердиктов (затухание 8 недель).
 * Возвращает новое состояние и правила, сменившие статус (до → после).
 */
export function recount<T extends WithVerdicts>(p: T, now: number): { state: T; changed: Array<{ ruleId: string; from: RuleStatus; to: RuleStatus }> } {
	const changed: Array<{ ruleId: string; from: RuleStatus; to: RuleStatus }> = []
	const rules = p.rules.map(r => {
		const own = Object.values(p.verdicts).flatMap(list => list.filter(v => v.ruleId === r.id))
		const c = ruleCounters(r, own, now)
		// как в applyVerdicts: счётчик лишь отправляет правило в архив, никогда не повышает и не понижает иначе
		const status: RuleStatus = r.status === 'archived' || c.status === 'archived' ? 'archived' : r.status
		if (status !== r.status) changed.push({ ruleId: r.id, from: r.status, to: status })
		return { ...r, up: c.up, down: c.down, status }
	})
	return { state: { ...p, rules }, changed }
}

/** Пробный режим: меньше трёх кейсов — ждём; среднее числа поправок больше прежнего — плейбук хуже. */
export function trialDecision(trial: NonNullable<PlaybookView['trial']>): 'pending' | 'pass' | 'fail' {
	if (trial.cases.length < 3 || trial.corrections.length < 3) return 'pending'
	const first = trial.corrections.slice(0, 3)
	const avg = first.reduce((a, b) => a + b, 0) / first.length
	return avg > trial.before ? 'fail' : 'pass'
}

/** Число пунктов разделов `### User corrections` описания, кроме `- none`. */
export function countCorrections(summary: string): number {
	let count = 0
	let inside = false
	for (const line of summary.split('\n')) {
		if (/^#{1,6}\s/.test(line)) {
			inside = /^###\s+User corrections\s*$/i.test(line.trim())
			continue
		}
		if (!inside) continue
		const m = /^[-*]\s+(.*\S)\s*$/.exec(line)
		if (m && !/^none\.?$/i.test(m[1] ?? '')) count++
	}
	return count
}
