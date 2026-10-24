import { goalsOf, stripGoals } from '../../domain/brief'
import { parseSummaryHeads } from '../../domain/collector'
import type { JobHandler } from './handlers.types'
import { payloadStr } from './payload'

/** Свёртка влитой цели в плейбук: цель уходит из описания сессии, плейбук получает «основан на сессии»; без целей кейс удаляется. */
export const foldHandler: JobHandler = {
	kinds: ['fold'],
	run(ctx) {
		const playbookId = payloadStr(ctx.job.payload, 'playbookId')
		const caseId = payloadStr(ctx.job.payload, 'caseId') || ctx.job.caseId
		const goal = payloadStr(ctx.job.payload, 'goal')
		const ps = ctx.playbooks
		const c = ctx.cases.get(caseId)
		const p = ps?.get(playbookId)
		if (!ps || !p) {
			ctx.finish('плейбук удалён: цель остаётся в сессии')
			return Promise.resolve()
		}
		if (!c) {
			ctx.finish('сессии уже нет')
			return Promise.resolve()
		}
		const summary = ctx.cases.summary(caseId)
		const session = ctx.cases.sessionTitle(caseId)
		const date = (c.closedAt ?? c.updatedAt).slice(0, 10)
		const has = goalsOf(summary).some(g => g.title.trim() === goal.trim())
		// цели в описании уже нет (свернули раньше или описание переписано): только отметка в плейбуке
		const rest = has ? stripGoals(summary, [goal]) : summary
		ps.addBasedOn(playbookId, { session, date })
		if (has) {
			if (rest !== null) {
				if (!ctx.cases.writeSummary(caseId, rest)) throw new Error('не удалось записать описание сессии')
				const heads = parseSummaryHeads(rest)
				ctx.cases.update({ ...c, goals: heads.goals, foldedGoals: (c.foldedGoals ?? 0) + 1, updatedAt: new Date(ctx.now()).toISOString() })
			} else ctx.cases.update({ ...c, goals: [], foldedGoals: (c.foldedGoals ?? 0) + 1 })
		}
		const left = rest === null ? 0 : goalsOf(rest).length
		if (left === 0 && c.status === 'ready') {
			ctx.log('info', playbookId, `Цель «${goal}» из сессии «${session}» влита в плейбук «${p.title}»; сессия удалена`)
			ctx.cases.drop(caseId)
		} else ctx.log('info', playbookId, `Цель «${goal}» из сессии «${session}» влита в плейбук «${p.title}»${left ? `; в сессии осталось целей: ${left}` : ''}`)
		ctx.finish()
		return Promise.resolve()
	},
}
