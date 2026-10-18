import type { CaseGoal } from '../../../shared/types'
import { renderPortion } from '../../domain/case-events'
import { buildCollectorPrompt, parseCollectorReply } from '../../domain/collector'
import { PORTION_CHARS } from '../../domain/learning-settings'
import type { JobContext, JobHandler } from './handlers.types'
import type { CaseState } from './learning.types'

/** Новая цель кейса с типом живого плейбука (`trial`/`active`) — подсказка в очередь сессии: её отдаст ближайший `hint`. */
function queueHints(ctx: JobContext, before: Pick<CaseState, 'id' | 'goals' | 'hinted' | 'playbook'>, after: CaseGoal[]): void {
	if (!ctx.hints || !ctx.playbooks) return
	const known = new Set(before.goals.map(g => g.type).filter(Boolean))
	const skip = new Set([...before.hinted, ...(before.playbook ? [before.playbook.split('@')[0] ?? ''] : [])])
	const types = new Set(after.map(g => g.type).filter(t => t && !known.has(t)))
	if (!types.size) return
	for (const p of ctx.playbooks.list()) {
		if ((p.status === 'trial' || p.status === 'active') && types.has(p.taskType) && !skip.has(p.id)) ctx.hints.queueHint(before.id, p.id)
	}
}

/** Сбор описания кейса (`collect` — по ходу, `close` — итоговый); поведение этапа 1 без изменений. */
export const collectHandler: JobHandler = {
	kinds: ['collect', 'close'],
	async run(ctx) {
		const { job } = ctx
		const c = ctx.cases.get(job.caseId)
		if (!c) {
			ctx.finish('кейс удалён')
			return
		}
		const events = ctx.cases.raw(c.id, c.coveredUntil + 1)
		if (!events.length) {
			ctx.finish()
			if (job.final) ctx.cases.seal(c.id)
			return
		}
		const portion = renderPortion(events, PORTION_CHARS)
		job.range = [portion.from, portion.until]
		ctx.changed()
		const prompt = buildCollectorPrompt(ctx.prompt('session-collector'), {
			caseId: c.id,
			summary: ctx.cases.summary(c.id),
			notes: ctx.cases.notes(c.id),
			portion,
			final: job.final,
		})
		const res = await ctx.runAgent(`collector-${c.id}`, `Описание сессии: ${c.title ?? c.id}`, prompt)
		const parsed = parseCollectorReply(res.text)
		if (!parsed) throw new Error('в ответе нет <summary>')
		// описание не записалось — курсор не двигаем, иначе события выпали бы из описания навсегда
		if (!ctx.cases.writeSummary(c.id, parsed.summary)) throw new Error('не удалось записать summary.md')
		const latest = ctx.cases.get(c.id)
		if (!latest) {
			ctx.finish('кейс удалён')
			return
		}
		const now = ctx.now()
		const goals = parsed.goals.length ? parsed.goals : latest.goals
		// снимок до update: сервис может отдавать и обновлять один и тот же объект
		const prior = { id: latest.id, goals: [...latest.goals], hinted: [...latest.hinted], playbook: latest.playbook }
		ctx.cases.update({
			...latest,
			coveredUntil: portion.until,
			title: parsed.title ?? latest.title,
			goals,
			lastRunAt: now,
			updatedAt: new Date(now).toISOString(),
		})
		queueHints(ctx, prior, goals)
		ctx.finish()
		// порция не дошла до конца событий: следующее задание того же вида ставится сразу
		if (events.some(e => e.n > portion.until)) ctx.enqueue(job.kind, c.id, { caseId: c.id, final: job.final })
		else if (job.final) ctx.cases.seal(c.id)
	},
}
