import type { JournalEntry, RuleView } from '../../../shared/types'
import { mergeRanges } from '../../domain/anchors'
import { renderPortion } from '../../domain/case-events'
import { fillPrompt, parseVerdicts } from '../../domain/learning-replies'
import type { Range, RuleVerdict } from '../../domain/playbook.types'
import { applyVerdicts, countCorrections, promoteCandidates, trialDecision } from '../../domain/rule-counters'
import type { JobContext, JobHandler } from './handlers.types'
import type { PlaybookState } from './learning.types'

/** Сколько знаков сырых событий уходит агенту. */
const EVENTS_CHARS = 24_000
/** Отступ вокруг якоря, событий. */
const PAD = 2

const ANCHOR = /(?<![\p{L}\d_])n (\d+)(?:\s*[–—-]\s*(\d+))?/gu

/** Диапазоны всех якорей `n a–b` текста. */
export function anchorRanges(text: string): Range[] {
	const out: Range[] = []
	for (const m of text.matchAll(ANCHOR)) {
		const from = Number(m[1])
		const to = m[2] === undefined ? from : Number(m[2])
		if (to >= from) out.push({ from, to })
	}
	return out
}

/** Строки раздела `### User corrections` описания. */
export function correctionsSection(summary: string): string {
	const out: string[] = []
	let inside = false
	for (const line of summary.split('\n')) {
		if (/^#{1,6}\s/.test(line)) inside = /^###\s+User corrections\s*$/i.test(line.trim())
		else if (inside) out.push(line)
	}
	return out.join('\n')
}

/** Сырые события кейса вокруг якорей: `[n] kind from→to: text`, куски через `…`. */
export function eventsAround(ctx: JobContext, caseId: string, ranges: readonly Range[], maxChars = EVENTS_CHARS): string {
	const parts: string[] = []
	let left = maxChars
	for (const r of mergeRanges(ranges, PAD)) {
		if (left <= 0) break
		const portion = renderPortion(ctx.cases.raw(caseId, r.from, r.to), left)
		if (!portion.text) continue
		parts.push(portion.text)
		left -= portion.text.length
	}
	return parts.join('\n…\n')
}

/** Id плейбука из `case.playbook` вида `<id>@<версия>`. */
export const playbookIdOf = (ref: string): string => ref.split('@')[0] ?? ''

/**
 * Судья: вердикты по правилам (`active` и `candidate`) плейбука кейса → счётчики и активация кандидатов →
 * новая версия, если что-то изменилось; пробный режим; при поправках в описании ставится `improve`.
 */
export const judgeHandler: JobHandler = {
	kinds: ['judge'],
	async run(ctx) {
		const { job, playbooks } = ctx
		const c = ctx.cases.get(job.caseId)
		const p = c?.playbook && playbooks ? playbooks.get(playbookIdOf(c.playbook)) : null
		if (!c || !playbooks || !p) {
			ctx.finish('у кейса нет плейбука')
			return
		}
		const summary = ctx.cases.summary(c.id)
		const judged = p.rules.filter(r => r.status === 'active' || r.status === 'candidate')
		let next: PlaybookState = p
		if (judged.length) {
			const mine = [...anchorRanges(summary), ...judged.flatMap(r => r.evidence.filter(e => e.caseId === c.id).flatMap(e => anchorRanges(e.anchor)))]
			const prompt = fillPrompt(ctx.prompt('judge'), {
				rules: judged.map(r => `- ${r.id}${r.stage === null ? '' : ` (stage ${r.stage})`}: ${r.text}`).join('\n'),
				summary,
				events: eventsAround(ctx, c.id, mine),
			})
			const res = await ctx.runAgent(`judge-${c.id}`, `Судья: ${c.title ?? c.id}`, prompt)
			const parsed = parseVerdicts(res.text)
			if (!parsed) throw new Error('в ответе судьи нет <result> с вердиктами')
			// только известные правила, по одному вердикту на правило
			const known = new Set(judged.map(r => r.id))
			const seen = new Set<string>()
			const verdicts: RuleVerdict[] = parsed.filter(v => known.has(v.ruleId) && !seen.has(v.ruleId) && seen.add(v.ruleId))
			next = promoteCandidates(applyVerdicts(p, c.id, verdicts, ctx.now()))
		}
		// пробный режим: кейс считается один раз, повторное закрытие заменяет число поправок
		const corrections = countCorrections(summary)
		if (next.status === 'trial' && next.trial) {
			const at = next.trial.cases.indexOf(c.id)
			const cases = at < 0 ? [...next.trial.cases, c.id] : next.trial.cases
			const list = [...next.trial.corrections]
			list[at < 0 ? cases.length - 1 : at] = corrections
			next = { ...next, trial: { ...next.trial, cases, corrections: list } }
		}
		const changedRules = next.rules.filter(r => p.rules.find(o => o.id === r.id)?.status !== r.status)
		const changed = JSON.stringify([next.rules, next.verdicts, next.trial]) !== JSON.stringify([p.rules, p.verdicts, p.trial])
		let saved = p
		if (changed) {
			const entry = (r: RuleView): Omit<JournalEntry, 'id' | 'ts'> => {
				const prev = p.rules.find(o => o.id === r.id)?.status ?? 'candidate'
				return {
					kind: r.status === 'archived' ? 'rule_archived' : 'rule_activated',
					subject: p.id,
					summary: `${p.id}: правило «${r.text}» ${prev} → ${r.status} (кейс ${c.id})`,
					report: JSON.stringify({ ruleId: r.id, prevStatus: prev }),
					revertible: true,
					revertedBy: null,
				}
			}
			const [first, ...rest] = changedRules
			saved = playbooks.saveVersion(next, `Judge ${c.id}: counters updated`, first ? entry(first) : undefined)
			for (const r of rest) playbooks.record(entry(r))
		}
		if (saved.status === 'trial' && saved.trial) {
			const decision = trialDecision(saved.trial)
			const t = saved.trial
			const info = `поправок ${t.corrections.join(', ')} при исходных ${t.before}`
			if (decision === 'fail') playbooks.setStatus(saved.id, 'disabled', `Пробный режим не пройден: ${info}`, 'trial_failed')
			else if (decision === 'pass') playbooks.setStatus(saved.id, 'active', `Пробный режим пройден: ${info}`, 'trial_passed')
		}
		if (corrections > 0) ctx.enqueue('improve', `improve:${c.id}`, { caseId: c.id })
		ctx.finish()
	},
}
