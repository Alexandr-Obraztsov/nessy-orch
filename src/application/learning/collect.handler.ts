import type { CaseGoal } from '../../../shared/types'
import { buildCollectorPrompt } from '../../domain/collector'
import { MAX_REJECTS } from '../../domain/learning-settings'
import { slugify } from '../../domain/naming'
import type { JobContext, JobHandler } from './handlers.types'
import type { CaseState, ProtocolState } from './learning.types'
import { initProtocol } from './read-protocol'

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

/** Сбор описания кейса (`collect` — по ходу, `close` — итоговый). Агент читает блоки и сдаёт описания сам (`case read` / `case draft`),
 * сервер проверяет и сохраняет принятое сразу; ответ агента не разбирается. */
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
		// события в промпт не вставляются: агент читает блоки сам; новый агент продолжает с принятого (`coveredUntil`)
		const lastN = events[events.length - 1]?.n ?? c.coveredUntil
		job.range = [events[0]?.n ?? c.coveredUntil + 1, lastN]
		job.protocol = initProtocol(c.coveredUntil, events.length)
		// состояние протокола меняют `case read`/`case draft` во время хода агента: читаем заново, не из сужения типа
		const proto = (): ProtocolState | null => job.protocol ?? null
		ctx.cases.writeDraft(c.id, '')
		ctx.changed()
		// снимок до принятых описаний: сервис может отдавать и обновлять один и тот же объект
		const prior = { id: c.id, goals: [...c.goals], hinted: [...c.hinted], playbook: c.playbook }
		const title = ctx.cases.sessionTitle(c.id)
		const prompt = buildCollectorPrompt(ctx.prompt('session-collector'), {
			caseId: c.id,
			sessionTitle: title,
			summary: ctx.cases.summary(c.id),
			notes: ctx.cases.notes(c.id),
			total: events.length,
			final: job.final,
			blockEvents: ctx.settings().blockEvents,
		})
		try {
			await ctx.runAgent(`session-${slugify(title, c.id)}`, title, prompt)
		} catch (e) {
			// отказы набрались на провал: агент снят, причина понятнее ошибки отмены
			if (!proto()?.exhausted) throw e
		}
		const p = proto()
		if (p?.exhausted) throw new Error(`${MAX_REJECTS} rejected drafts for one block: the accepted blocks are kept, a fresh agent continues from n ${p.ackedUntil + 1}`)
		// ответ агента (формат, `<summary>`) не важен: итог — только принятые сервером описания
		if (!p || (p.blocks === 0 && !p.finalAccepted)) throw new Error('no progress: the agent ended without an accepted summary of any block')
		const latest = ctx.cases.get(c.id)
		if (!latest) {
			ctx.finish('кейс удалён')
			return
		}
		ctx.cases.update({ ...latest, lastRunAt: ctx.now() })
		queueHints(ctx, prior, latest.goals)
		ctx.cases.writeDraft(c.id, '')
		// не всё принято (агент ушёл раньше `done`): провал попытки, повтор продолжит с принятого
		const left = ctx.cases.raw(c.id, latest.coveredUntil + 1).length
		if (left) throw new Error(`the agent ended before all events were accepted (${left} left after n ${latest.coveredUntil}): the accepted blocks are kept`)
		ctx.finish()
		if (job.final) ctx.cases.seal(c.id)
	},
}
