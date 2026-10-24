import type { JobHandler } from '../../src/application/learning/handlers.types'

/**
 * Упрощённый сборщик: очередь и состояния не зависят от протокола чтения. Агент отвечает — всё учтено
 * (`coveredUntil = events`, `lastRunAt`), `close` запечатывает кейс; не отвечает или ошибка — исключение.
 */
export const stubCollect: JobHandler = {
	kinds: ['collect', 'close'],
	async run(ctx) {
		const c = ctx.cases.get(ctx.job.caseId)
		if (!c) return ctx.finish('кейс удалён')
		await ctx.runAgent(`session-${c.id}`, c.id, 'x')
		const latest = ctx.cases.get(c.id)
		if (!latest) return ctx.finish('кейс удалён')
		ctx.cases.update({ ...latest, coveredUntil: latest.events, lastRunAt: ctx.now() })
		ctx.finish()
		if (ctx.job.final) ctx.cases.seal(c.id)
	},
}
