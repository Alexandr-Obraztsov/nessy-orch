import { renderPortion } from '../../domain/case-events'
import { buildCollectorPrompt, parseCollectorReply } from '../../domain/collector'
import { PORTION_CHARS } from '../../domain/learning-settings'
import type { JobHandler } from './handlers.types'

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
		ctx.cases.update({
			...latest,
			coveredUntil: portion.until,
			title: parsed.title ?? latest.title,
			goals: parsed.goals.length ? parsed.goals : latest.goals,
			lastRunAt: now,
			updatedAt: new Date(now).toISOString(),
		})
		ctx.finish()
		// порция не дошла до конца событий: следующее задание того же вида ставится сразу
		if (events.some(e => e.n > portion.until)) ctx.enqueue(job.kind, c.id, { caseId: c.id, final: job.final })
		else if (job.final) ctx.cases.seal(c.id)
	},
}
