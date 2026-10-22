/** Очередь заданий обучения: дедупликация, один running на кейс, повторы, лимит завершённых. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { JobQueue } from '../../../src/application/learning/job-queue'
import type { JobState } from '../../../src/application/learning/learning.types'

function make() {
	let n = 0
	const clock = { t: 1_000_000 }
	const q = new JobQueue({ ids: { next: () => String(++n).padStart(8, '0') }, now: () => clock.t })
	return { q, clock }
}

describe('JobQueue', () => {
	it('collect + collect одного кейса — одно задание; final объединяется', () => {
		const { q } = make()
		const a = q.enqueue('collect', 'c1', { caseId: 'c1', final: false })
		const b = q.enqueue('collect', 'c1', { caseId: 'c1', final: true })
		assert.equal(a.id, b.id)
		assert.equal(q.list().length, 1)
		assert.equal(b.final, true)
		assert.match(a.id, /^j-/)
	})

	it('collect в очереди + close — одно close с final', () => {
		const { q } = make()
		q.enqueue('collect', 'c1', { caseId: 'c1', final: false })
		const j = q.enqueue('close', 'c1', { caseId: 'c1', final: true })
		assert.equal(q.list().length, 1)
		assert.equal(j.kind, 'close')
		assert.equal(j.final, true)
		q.enqueue('collect', 'c1', { caseId: 'c1', final: false })
		assert.equal(q.list()[0]?.kind, 'close')
	})

	it('running + enqueue: второе ждёт, next не отдаёт его, пока кейс running', () => {
		const { q, clock } = make()
		const a = q.enqueue('collect', 'c1', { caseId: 'c1', final: false })
		q.start(a.id, 'ag')
		const b = q.enqueue('collect', 'c1', { caseId: 'c1', final: false })
		assert.notEqual(a.id, b.id)
		assert.equal(q.next(clock.t), null)
		const other = q.enqueue('collect', 'c2', { caseId: 'c2', final: false })
		assert.equal(q.next(clock.t)?.id, other.id)
		q.finish(a.id)
		assert.equal(q.next(clock.t)?.id, b.id)
		assert.deepEqual(q.list().map(j => j.id), [a.id, b.id, other.id])
	})

	it('повторы бесконечные: пауза 5 с × 2^(попытка−1), не больше 2 мин, error — последняя ошибка, статус не error', () => {
		const { q, clock } = make()
		const a = q.enqueue('collect', 'c1', { caseId: 'c1', final: false })
		q.start(a.id, null)
		let j = q.fail(a.id, 'e1')
		assert.equal(j.status, 'queued')
		assert.equal(j.retryAt, clock.t + 5_000)
		assert.equal(j.error, 'e1')
		assert.equal(q.next(clock.t), null)
		assert.equal(q.next(clock.t + 5_000)?.id, a.id)
		q.start(a.id, null)
		j = q.fail(a.id, 'e2')
		assert.equal(j.retryAt, clock.t + 10_000)
		q.start(a.id, null)
		j = q.fail(a.id, 'e3')
		assert.equal(j.status, 'queued')
		assert.equal(j.attempts, 3)
		assert.equal(j.error, 'e3')
		assert.equal(j.retryAt, clock.t + 20_000)
		assert.equal(j.finishedAt, null)
		assert.equal(q.hasJob('c1'), true)
		for (let i = 0; i < 40; i++) {
			q.start(a.id, null)
			j = q.fail(a.id, `e${i}`)
		}
		assert.equal(j.status, 'queued')
		assert.equal(j.attempts, 43)
		assert.equal(j.retryAt, clock.t + 120_000)
	})

	it('провал при ждущем задании того же объекта: остаётся одно, final и close сводятся, срок — более ранний', () => {
		const { q, clock } = make()
		const a = q.enqueue('collect', 'c1', { caseId: 'c1', final: false })
		q.start(a.id, null)
		const b = q.enqueue('close', 'c1', { caseId: 'c1', final: true })
		const j = q.fail(a.id, 'e')
		assert.equal(j.id, a.id)
		assert.equal(j.kind, 'close')
		assert.equal(j.final, true)
		assert.equal(j.retryAt, null) // ручная постановка не ждала паузы
		assert.equal(b.status, 'done')
		assert.equal(b.note, `объединено с ${a.id}`)
		assert.equal(q.list().filter(x => x.subject === 'c1' && x.status === 'queued').length, 1)
		assert.deepEqual(q.takeAbsorbed().map(x => x.id), [b.id])
		assert.equal(q.next(clock.t)?.id, a.id)
	})

	it('touch: только идущее задание; start ставит activityAt', () => {
		const { q, clock } = make()
		const a = q.enqueue('collect', 'c1', { caseId: 'c1', final: false })
		assert.equal(q.touch(a.id), false)
		q.start(a.id, null)
		assert.equal(a.activityAt, clock.t)
		clock.t += 5_000
		assert.equal(q.touch(a.id), true)
		assert.equal(a.activityAt, clock.t)
		q.fail(a.id, 'e')
		assert.equal(a.activityAt, null)
	})

	it('delayMs откладывает первый запуск', () => {
		const { q, clock } = make()
		const a = q.enqueue('collect', 'c1', { caseId: 'c1', final: false, delayMs: 30_000 })
		assert.equal(q.next(clock.t), null)
		assert.equal(q.next(clock.t + 30_000)?.id, a.id)
		q.start(a.id, null)
		assert.equal(a.status, 'running')
	})

	it('retry: только из error', () => {
		const { q } = make()
		const a = q.enqueue('collect', 'c1', { caseId: 'c1', final: false })
		assert.throws(() => q.retry(a.id), { status: 409, code: 'job_not_failed' })
		assert.throws(() => q.retry('j-nope'), { status: 404, code: 'no_job' })
		q.start(a.id, null)
		q.fail(a.id, 'x')
		a.status = 'error' // ошибка только из старого состояния на диске
		const j = q.retry(a.id)
		assert.equal(j.status, 'queued')
		assert.equal(j.attempts, 0)
		assert.equal(j.retryAt, null)
		assert.equal(j.error, null)
	})

	it('load: running возвращается в queued с пометкой', () => {
		const { q, clock } = make()
		const a = q.enqueue('collect', 'c1', { caseId: 'c1', final: false })
		q.start(a.id, 'ag')
		const saved = JSON.parse(JSON.stringify(q.list())) as JobState[]
		const { q: q2 } = make()
		q2.load(saved)
		const j = q2.list()[0]
		assert.equal(j?.status, 'queued')
		assert.equal(j.note, 'прервано перезапуском')
		assert.equal(j.startedAt, null)
		assert.equal(q2.next(clock.t)?.id, a.id)
		assert.equal(q2.running().length, 0)
	})

	it('хранится не больше 200 завершённых; активные остаются; removeCase и toView', () => {
		const { q } = make()
		const active = q.enqueue('collect', 'active', { caseId: 'active', final: false })
		for (let i = 0; i < 205; i++) {
			const j = q.enqueue('collect', `c${i}`, { caseId: `c${i}`, final: false })
			q.start(j.id, null)
			q.finish(j.id)
		}
		const all = q.list()
		assert.equal(all.filter(j => j.status === 'done').length, 200)
		assert.ok(all.some(j => j.id === active.id))
		assert.equal(all.some(j => j.caseId === 'c0'), false)
		assert.equal(all.some(j => j.caseId === 'c204'), true)
		const view = q.toView(active)
		assert.equal('final' in view, false)
		assert.equal(view.retryAt, null)
		assert.equal(view.waiting, null)
		assert.equal('activityAt' in view, false)
		assert.equal(view.title, null)
		assert.equal(view.progress, null)
		q.removeCase('active')
		assert.equal(q.hasJob('active'), false)
	})

	it('merge сводит payload ждущего задания по subject; без merge побеждает новый', () => {
		const { q } = make()
		const ids = (x: Record<string, unknown> | null): string[] => (Array.isArray(x?.['caseIds']) ? x['caseIds'].map(String) : [])
		const merge = (a: Record<string, unknown> | null, b: Record<string, unknown> | null) => ({ caseIds: [...new Set([...ids(a), ...ids(b)])] })
		const a = q.enqueue('match', 'all', { payload: { caseIds: ['c1'] }, merge })
		const b = q.enqueue('match', 'all', { payload: { caseIds: ['c2', 'c1'] }, merge })
		assert.equal(a.id, b.id)
		assert.equal(q.list().length, 1)
		assert.deepEqual(b.payload, { caseIds: ['c1', 'c2'] })
		assert.equal(b.caseId, '')
		const x = q.enqueue('build', 'g-1', { payload: { v: 1 } })
		const y = q.enqueue('build', 'g-1', { payload: { v: 2 } })
		assert.equal(x.id, y.id)
		assert.deepEqual(y.payload, { v: 2 })
		assert.equal(q.enqueue('build', 'g-1').payload?.['v'], 2)
	})

	it('одно running на subject; разные subject одного кейса не мешают друг другу', () => {
		const { q, clock } = make()
		const a = q.enqueue('judge', 'c1', { caseId: 'c1' })
		q.start(a.id, null)
		const b = q.enqueue('build', 'g-1', { caseId: 'c1' })
		assert.equal(q.next(clock.t)?.id, b.id)
	})

	it('isWaiting: ждущее задание пропускается, следующее отдаётся', () => {
		const { q, clock } = make()
		const a = q.enqueue('match', 'all', { payload: { after: ['c1'] } })
		const b = q.enqueue('collect', 'c2', { caseId: 'c2' })
		const waiting = (j: JobState) => j.payload?.['after'] !== undefined
		assert.equal(q.next(clock.t, waiting)?.id, b.id)
		q.start(b.id, null)
		assert.equal(q.next(clock.t, waiting), null)
		assert.equal(q.next(clock.t)?.id, a.id)
	})
})
