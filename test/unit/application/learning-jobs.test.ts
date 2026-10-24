/** Исполнение заданий обучения: сборщик сессии, повторы, статусы кейса, насос, остановка. */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import type { HubEvent, Message, SessionView } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { CaseState, JobState, LearningHost } from '../../../src/application/learning/learning.types'
import { YOU } from '../../../src/domain/constants'
import { observe } from '../../support/signals'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { drainReads, submitBlock, summaryFor, withBrief } from '../../support/read-blocks'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')

const session = (id: string, patch: Partial<SessionView> = {}): SessionView => ({
	id,
	title: id,
	owner: null,
	status: 'active',
	summary: null,
	createdAt: new Date(T0 + 60_000).toISOString(),
	updatedAt: new Date(T0).toISOString(),
	sources: 0,
	chatId: `chat-${id}`,
	...patch,
})

let seq = 0
const msg = (session: string, text = `текст ${seq + 1}`): Message => {
	seq += 1
	return { seq, id: `m${seq}`, ts: T0 + seq * 1000, from: YOU, to: 'a1', kind: 'msg', text, hops: 0, session }
}

const GOOD = (title = 'T'): string => `<summary>\n# ${title}\n</summary>\n<meta>{"title":"${title}","goals":[{"title":"g","type":"t"}]}</meta>`

type Reply = { ok: boolean; text: string; error?: string }
interface Call {
	name: string
	title: string
	prompt: string
}

const flush = async (): Promise<void> => {
	for (let i = 0; i < 5; i++) await new Promise<void>(r => setImmediate(r))
}

describe('LearningService: задания', () => {
	let store: MemoryLearningStore
	let hub: Hub
	let events: HubEvent[]
	let sessions: SessionView[]
	let feed: Message[]
	let calls: Call[]
	/** ответы по порядку вызовов; функция может ждать промис */
	let script: Array<Reply | (() => Promise<Reply>)>
	const clock = { t: T0 + 60_000, now: () => clock.t }

	let current: LearningService | null = null
	/** false — агент сам читает ровно сколько нужно (сценарий в `script`) */
	let drain = true
	const host: LearningHost = {
		sessions: () => sessions,
		messagesSince: s => feed.filter(m => m.seq > s),
		lastSeq: () => 0,
		sessionOfMessage: m => m.session ?? null,
		isBusy: () => false,
		cancelAgent: () => Promise.resolve(),
		runAgent: async req => {
			if (drain) drainReads(current)
			calls.push(req)
			const step = script.shift() ?? { ok: true, text: GOOD() }
			const r = typeof step === 'function' ? await step() : step
			return { agentId: `ag${calls.length}`, ...r }
		},
	}

	const make = (): LearningService => {
		// блоки по 25 событий, сторож выключен: тесты ведут время сами
		store.settingsRaw = { blockEvents: 25, blockChars: 12_000, stallMin: 0, ...(typeof store.settingsRaw === 'object' && store.settingsRaw !== null ? store.settingsRaw : {}) }
		const s = new LearningService({ store, host, hub, clock, ids: { next: () => `id${Math.random().toString(36).slice(2, 8)}` }, defaultOn: true, claudeProjectsDir: '/p' })
		current = s
		s.load()
		return s
	}
	const setSettings = (raw: unknown): void => {
		store.settingsRaw = raw
		store.mtimeMs += 1
	}
	/** управляемый ответ: вызвать `release()`, чтобы агент «ответил» */
	const gate = (reply: Reply = { ok: true, text: GOOD() }): { step: () => Promise<Reply>; release: () => void } => {
		let release = (): void => {}
		const p = new Promise<void>(r => {
			release = r
		})
		return { step: () => p.then(() => reply), release }
	}
	const jobs = (svc: LearningService) => svc.view().jobs
	/** повтор после ошибки: проходит `retrySec` (60 с), задание делает новую попытку */
	const retry = async (): Promise<void> => {
		mock.timers.tick(60_000)
		await flush()
	}

	afterEach(() => {
		mock.timers.reset()
	})

	beforeEach(() => {
		mock.timers.enable({ apis: ['setTimeout'] })
		seq = 0
		store = new MemoryLearningStore()
		store.prompts.set('session-collector', '{{mode}}|{{total}}|{{summary}}')
		hub = new Hub()
		events = []
		hub.subscribe(e => events.push(e))
		sessions = [session('s1')]
		feed = []
		calls = []
		script = []
		drain = true
		clock.t = T0 + 60_000
	})

	it('сессия закончена: одно close, summary записан, coveredUntil = 15, ready, learning_case опубликован', async () => {
		const svc = make()
		feed = Array.from({ length: 15 }, () => msg('s1'))
		observe(svc, 's1')
		assert.equal(jobs(svc).length, 0) // активность заданий не ставит
		events.length = 0
		svc.onSessionClosed('s1')
		assert.equal(jobs(svc).length, 1)
		assert.equal(jobs(svc)[0]?.kind, 'close')
		assert.equal(jobs(svc)[0]?.status, 'running')
		assert.deepEqual(jobs(svc)[0]?.range, [1, 15])
		await flush()
		assert.equal(calls.length, 1)
		assert.equal(calls[0]?.name, 'session-s1')
		assert.equal(calls[0].title, 's1')
		assert.match(store.summaries.get('c-s1') ?? '', /^# T\n## Goal: do the task/)
		const c = svc.getCase('c-s1')
		assert.equal(c.coveredUntil, 15)
		// <meta>.title сборщика игнорируется: название кейса — название сессии
		assert.equal(c.title, 's1')
		assert.deepEqual(c.goals, [{ title: 'do the task', type: 'do task' }])
		assert.equal(c.status, 'ready')
		assert.equal(jobs(svc)[0]?.status, 'done')
		assert.equal(jobs(svc)[0]?.agentId, 'ag1')
		assert.ok(events.some(e => e.t === 'learning_case' && e.case.coveredUntil === 15))
		assert.ok(events.some(e => e.t === 'learning_job' && e.job.status === 'done'))
		assert.equal(store.jobs[0]?.status, 'done')
		assert.equal(store.cases.get('c-s1')?.coveredUntil, 15)
	})

	it('ответ агента без <summary> не мешает: итог — принятые сервером описания', async () => {
		const svc = make()
		feed = [msg('s1'), msg('s1')]
		observe(svc, 's1')
		script = [{ ok: true, text: 'нет блока, просто текст' }]
		svc.runNow('c-s1')
		await flush()
		assert.equal(jobs(svc)[0]?.status, 'done')
		assert.match(store.summaries.get('c-s1') ?? '', /^# T\n## Goal: do the task \(type: do task\)/)
		assert.equal(svc.getCase('c-s1').coveredUntil, 2)
		assert.deepEqual(svc.getCase('c-s1').goals, [{ title: 'do the task', type: 'do task' }])
	})

	it('агент не принял ни одного блока: провал no progress, задание остаётся running, повтор через retrySec (постоянная пауза), summary и coveredUntil не тронуты, кейс не в error', async () => {
		const svc = make()
		store.summaries.set('c-s1', 'старое')
		feed = [msg('s1')]
		observe(svc, 's1')
		drain = false
		svc.runNow('c-s1')
		await flush()
		assert.equal(calls.length, 1)
		assert.equal(jobs(svc)[0]?.status, 'running')
		assert.equal(jobs(svc)[0]?.attempts, 1)
		assert.match(jobs(svc)[0]?.error ?? '', /^no progress/)
		assert.equal(store.summaries.get('c-s1'), 'старое')
		assert.equal(svc.getCase('c-s1').coveredUntil, 0)
		assert.notEqual(svc.getCase('c-s1').status, 'error')
		mock.timers.tick(59_000)
		await flush()
		assert.equal(calls.length, 1) // 60 с ещё не прошло
		await retry()
		assert.equal(calls.length, 2)
		assert.equal(jobs(svc)[0]?.attempts, 2)
		await retry() // пауза та же, без роста
		assert.equal(calls.length, 3)
		drain = true
		await retry()
		assert.equal(calls.length, 4)
		assert.equal(jobs(svc)[0]?.status, 'done')
		assert.match(store.summaries.get('c-s1') ?? '', /^# T/)
	})

	it('ok: false и исключение — тоже провал с текстом', async () => {
		const svc = make()
		feed = [msg('s1')]
		observe(svc, 's1')
		drain = false
		script = [{ ok: false, text: '', error: 'таймаут' }]
		svc.runNow('c-s1')
		await flush()
		assert.equal(jobs(svc)[0]?.error, 'таймаут')
		script = [() => Promise.reject(new Error('сеть'))]
		await retry()
		assert.equal(jobs(svc)[0]?.error, 'сеть')
		assert.equal(jobs(svc)[0]?.attempts, 2)
	})

	it('onSessionClosed → close; после ответа ready с closedAt; новое событие → collecting, следующий close дописывает', async () => {
		const svc = make()
		feed = [msg('s1'), msg('s1')]
		observe(svc, 's1')
		svc.onSessionClosed('s1')
		assert.equal(jobs(svc)[0]?.kind, 'close')
		assert.equal(svc.getCase('c-s1').status, 'closing')
		assert.match(calls[0]?.prompt ?? '', /^final:/)
		await flush()
		const c = svc.getCase('c-s1')
		assert.equal(c.status, 'ready')
		assert.equal(c.closedAt, new Date(clock.t).toISOString())
		assert.equal(c.coveredUntil, 2)
		feed.push(msg('s1'))
		script = [{ ok: true, text: GOOD('Два') }]
		observe(svc, 's1') // работа возобновилась: ready → collecting, задания нет
		assert.equal(svc.getCase('c-s1').status, 'collecting')
		assert.equal(svc.getCase('c-s1').closedAt, null)
		assert.equal(jobs(svc).filter(j => j.status !== 'done').length, 0)
		svc.onSessionClosed('s1')
		assert.match(calls[1]?.prompt ?? '', /^final:[^|]*\|1\|# T\n## Goal/) // только новые события, прежнее описание ушло в промпт
		await flush()
		assert.equal(svc.getCase('c-s1').coveredUntil, 3)
		assert.equal(svc.getCase('c-s1').status, 'ready')
	})

	it('агент принял один блок из трёх и ушёл: coveredUntil — до принятого, провал попытки, повтор по retrySec; новый агент начинает с ackedUntil', async () => {
		const svc = make()
		feed = Array.from({ length: 60 }, () => msg('s1', 'x'))
		observe(svc, 's1')
		drain = false
		const firsts: number[] = []
		script = [
			() => {
				firsts.push(submitBlock(svc, 'c-s1').from)
				return Promise.resolve({ ok: true, text: 'устал' })
			},
			() => {
				firsts.push(submitBlock(svc, 'c-s1').from)
				submitBlock(svc, 'c-s1')
				return Promise.resolve({ ok: true, text: 'конец' })
			},
		]
		svc.onSessionClosed('s1')
		await flush()
		assert.deepEqual(firsts, [1])
		assert.equal(svc.getCase('c-s1').coveredUntil, 25)
		assert.equal(jobs(svc)[0]?.status, 'running') // слот за заданием до повтора
		assert.equal(jobs(svc)[0]?.attempts, 1)
		assert.match(jobs(svc)[0]?.error ?? '', /ended before all events were accepted/)
		await retry()
		assert.deepEqual(firsts, [1, 26]) // второй агент не читает принятое заново
		assert.equal(calls.length, 2)
		assert.equal(svc.getCase('c-s1').coveredUntil, 60)
		assert.equal(svc.getCase('c-s1').status, 'ready')
		assert.equal(jobs(svc).filter(j => j.status === 'done').length, 1)
		assert.ok(jobs(svc).every(j => j.kind === 'close'))
	})

	it('полный проход на три блока (25 + 25 + 10): drain сдаёт блоки и --final, кейс ready', async () => {
		const svc = make()
		feed = Array.from({ length: 60 }, () => msg('s1', 'x'))
		observe(svc, 's1')
		svc.onSessionClosed('s1')
		await flush()
		assert.equal(calls.length, 1)
		const c = svc.getCase('c-s1')
		assert.equal(c.coveredUntil, 60)
		assert.equal(c.status, 'ready')
		assert.match(store.summaries.get('c-s1') ?? '', /\(n 60\)/)
		assert.equal(jobs(svc)[0]?.status, 'done')
	})

	it('read без принятого описания: 409 summary_required; описание с пропуском события: REJECTED R2; три отказа — провал, чекпоинт сохранён, свежий агент продолжает с принятого', async () => {
		const svc = make()
		feed = Array.from({ length: 30 }, () => msg('s1', 'x'))
		observe(svc, 's1')
		drain = false
		const failures: string[] = []
		script = [
			() => {
				assert.throws(() => svc.caseDraft('c-s1', '# x', false), { status: 409, code: 'no_block' })
				submitBlock(svc, 'c-s1') // блок 1 принят: чекпоинт
				const b = svc.caseRead('c-s1') // блок 2 выдан
				assert.equal(b.from, 26)
				assert.match(b.header, /^BLOCK 2 \(n 26–30\), events 25\/30 acknowledged$/)
				assert.throws(() => svc.caseRead('c-s1'), { status: 409, code: 'summary_required', message: /^Block n 26–30 has no accepted summary yet\. Submit the updated summary with 'nessy-orch case draft'/ })
				const full = summaryFor(svc.caseRaw('c-s1', 1, 30), b)
				const bad = full.split('\n').filter(l => !l.includes('(n 28)')).join('\n')
				for (let i = 1; i <= 3; i++) {
					try {
						svc.caseDraft('c-s1', bad, false)
					} catch (e) {
						failures.push(e instanceof Error ? e.message : String(e))
					}
				}
				return Promise.resolve({ ok: true, text: 'не вышло' })
			},
			() => {
				// свежий агент: читает блок 2, а не блок 1
				const b = svc.caseRead('c-s1')
				assert.equal(b.from, 26)
				svc.caseDraft('c-s1', summaryFor(svc.caseRaw('c-s1', 1, 30), b), false)
				return Promise.resolve({ ok: true, text: 'ок' })
			},
		]
		svc.runNow('c-s1')
		await flush()
		assert.equal(failures.length, 3)
		assert.match(failures[0] ?? '', /^REJECTED \(attempt 1\/3\): R2: coverage: events n 28 /)
		assert.match(failures[0] ?? '', /Fix only the listed items\. Do not resubmit until all checks pass\.$/)
		assert.match(failures[2] ?? '', /^REJECTED \(attempt 3\/3\)/)
		assert.equal(jobs(svc)[0]?.attempts, 1)
		assert.match(jobs(svc)[0]?.error ?? '', /3 rejected drafts/)
		assert.equal(svc.getCase('c-s1').coveredUntil, 25) // чекпоинт блока 1 сохранён
		assert.match(store.summaries.get('c-s1') ?? '', /\(n 25\)/)
		await retry()
		assert.equal(calls.length, 2)
		assert.equal(jobs(svc)[0]?.status, 'done')
		assert.equal(svc.getCase('c-s1').coveredUntil, 30)
	})

	/** упрямый агент: читает блок и три раза сдаёт мусор; сообщения гейта складываются в `msgs` */
	const stubborn = (svc: LearningService, msgs: string[], text = '# x'): (() => Promise<Reply>) => () => {
		svc.caseRead('c-s1')
		for (let i = 0; i < 3; i++) {
			try {
				msgs.push(svc.caseDraft('c-s1', text, false).message)
			} catch (e) {
				msgs.push(e instanceof Error ? e.message : String(e))
			}
		}
		return Promise.resolve({ ok: true, text: 'не вышло' })
	}

	it('лестница смягчения: упрямец проходит блок не более чем за 3 задания; на последней ступени сервер сам описывает блок (auto), счётчик сбрасывается', async () => {
		const svc = make()
		feed = [msg('s1', 'a1'), msg('s1', 'b2'), msg('s1', 'c3')]
		observe(svc, 's1')
		drain = false
		const msgs: string[] = []
		script = [stubborn(svc, msgs), stubborn(svc, msgs), stubborn(svc, msgs)]
		svc.runNow('c-s1')
		await flush()
		assert.equal(svc.getCase('c-s1').blockFails?.fails, 1)
		assert.equal(svc.getCase('c-s1').coveredUntil, 0)
		for (let i = 0; i < 2; i++) {
			await retry()
		}
		assert.equal(calls.length, 3)
		assert.match(msgs[0] ?? '', /^REJECTED \(attempt 1\/3\)/)
		assert.match(msgs[2] ?? '', /^REJECTED \(attempt 3\/3\).*Attempt limit reached/)
		assert.match(msgs[5] ?? '', /^REJECTED \(attempt 3\/3\)/)
		// третье задание: первая же сдача принимается
		assert.match(msgs[6] ?? '', /^ACCEPTED \(gate waived after repeated rejections: description built by the server, marked \(auto\)\): block n 1–3 closed/)
		const c = svc.getCase('c-s1')
		assert.equal(c.coveredUntil, 3)
		assert.equal(c.blockFails?.fails, 0)
		assert.match(store.summaries.get('c-s1') ?? '', /- \(auto\) \[1\] task .*: a1 \(n 1\)/)
		assert.equal(jobs(svc).filter(j => j.status === 'done').length, 1)
	})

	it('лестница: после одного исчерпания R4/R6/R7 — предупреждения (ACCEPTED with warnings), прочие правила жёстки; принятие сбрасывает счётчик', async () => {
		const svc = make()
		feed = Array.from({ length: 12 }, () => msg('s1', 'x'))
		observe(svc, 's1')
		drain = false
		const msgs: string[] = []
		const sparse = (): string => {
			const b = svc.caseRead('c-s1')
			const full = summaryFor(svc.caseRaw('c-s1', 1, b.until), b)
			return full.split('\n').filter(l => !/^- task step/.test(l)).join('\n').replace('### Actions', '### Actions\n- everything (n 1–12)')
		}
		script = [
			stubborn(svc, msgs),
			() => {
				const text = sparse()
				// R4 (мало пунктов) на ступени 1 — предупреждение; R9 по-прежнему жёсткое
				assert.throws(() => svc.caseDraft('c-s1', '# x\n' + text.split('\n').slice(1).join('\n').replace('### Skipped', '### Nope'), false), { code: 'rejected' })
				msgs.push(svc.caseDraft('c-s1', text, false).message)
				return Promise.resolve({ ok: true, text: '' })
			},
		]
		svc.runNow('c-s1')
		await flush()
		assert.equal(svc.getCase('c-s1').blockFails?.fails, 1)
		await retry()
		assert.match(msgs[3] ?? '', /^ACCEPTED with warnings: R4: density: 1 anchored items/)
		assert.equal(svc.getCase('c-s1').coveredUntil, 12)
		assert.equal(svc.getCase('c-s1').blockFails?.fails, 0)
	})

	it('ступень ≥ 2: прошёл только каркас (R1, R3, R9) — блок принят, непокрытые события сервер дописывает в ### Skipped', async () => {
		const svc = make()
		feed = Array.from({ length: 6 }, () => msg('s1', 'x'))
		observe(svc, 's1')
		drain = false
		const c = svc.getCase('c-s1')
		store.saveCase({ ...c, blockFails: { from: 1, fails: 2 } })
		const svc2 = make()
		let got = ''
		script = [
			() => {
				const b = svc2.caseRead('c-s1')
				const text = summaryFor(svc2.caseRaw('c-s1', 1, b.until), b).replace(/^- task step.*\(n [2-6]\)$/gm, '')
				got = svc2.caseDraft('c-s1', text, false).message
				return Promise.resolve({ ok: true, text: '' })
			},
		]
		svc2.runNow('c-s1')
		await flush()
		assert.match(got, /^ACCEPTED \(gate waived after repeated rejections\): block n 1–6 closed/)
		assert.match(store.summaries.get('c-s1') ?? '', /### Skipped\n- n 2–6 — not summarized \(gate waived after repeated rejections\)/)
	})

	it('--final только после done; после done обычный draft — 409 no_block; итог сохраняет сервер, задание завершается без ответа агента', async () => {
		const svc = make()
		feed = [msg('s1', 'x'), msg('s1', 'y')]
		observe(svc, 's1')
		drain = false
		script = [
			() => {
				assert.throws(() => svc.caseDraft('c-s1', '# x', true), { status: 409, code: 'not_done' })
				const b = submitBlock(svc, 'c-s1')
				assert.equal(b.done, false)
				const d = svc.caseRead('c-s1')
				assert.equal(d.done, true)
				assert.match(d.card, /case draft --final/)
				assert.throws(() => svc.caseDraft('c-s1', summaryFor(svc.caseRaw('c-s1', 1, 2), b), false), { status: 409, code: 'no_block' })
				const r = svc.caseDraft('c-s1', withBrief(svc.getCaseDetail('c-s1').summary), true)
				assert.equal(r.final, true)
				return Promise.resolve({ ok: true, text: '' })
			},
		]
		svc.runNow('c-s1')
		await flush()
		assert.equal(jobs(svc)[0]?.status, 'done')
		assert.equal(svc.getCase('c-s1').coveredUntil, 2)
	})

	it('draft.md очищается при старте и в конце; read/draft публикуют learning_job с progress и phase (reading ↔ summarizing)', async () => {
		const svc = make()
		feed = Array.from({ length: 30 }, () => msg('s1', 'z'.repeat(50)))
		observe(svc, 's1')
		store.drafts.set('c-s1', 'старый черновик')
		drain = false
		const seen: Array<[{ read: number; total: number } | null, string | null | undefined]> = []
		script = [
			() => {
				assert.equal(store.drafts.has('c-s1'), false) // старый черновик убран при старте
				events.length = 0
				const b = svc.caseRead('c-s1')
				assert.equal(jobs(svc)[0]?.phase, 'summarizing')
				svc.caseDraft('c-s1', summaryFor(svc.caseRaw('c-s1', 1, b.until), b), false)
				for (const e of events) if (e.t === 'learning_job') seen.push([e.job.progress, e.job.phase])
				assert.equal(jobs(svc)[0]?.phase, 'reading')
				assert.deepEqual(svc.getCaseDetail('c-s1').progress, { read: 25, total: 30 })
				assert.match(svc.getCaseDetail('c-s1').draft, /^# T/)
				drainReads(svc)
				return Promise.resolve({ ok: true, text: 'x' })
			},
		]
		svc.runNow('c-s1')
		await flush()
		assert.deepEqual(seen[0], [{ read: 0, total: 30 }, 'summarizing'])
		assert.deepEqual(seen.at(-1), [{ read: 25, total: 30 }, 'reading'])
		assert.equal(store.drafts.has('c-s1'), false)
		assert.equal(svc.getCaseDetail('c-s1').progress, null)
		assert.equal(svc.getCase('c-s1').coveredUntil, 30)
		// служебное состояние протокола наружу не отдаётся
		assert.equal('protocol' in (svc.view().jobs[0] ?? {}), false)
	})

	it('блок: не больше 25 событий и 12 000 знаков, одно событие берётся всегда; без идущего задания — 409 no_job', async () => {
		const svc = make()
		feed = Array.from({ length: 6 }, () => msg('s1', 'ab '.repeat(666).trim()))
		observe(svc, 's1')
		assert.throws(() => svc.caseRead('c-s1'), { status: 409, code: 'no_job' })
		drain = false
		const got: number[][] = []
		script = [
			() => {
				for (let i = 0; i < 2; i++) {
					const b = svc.caseRead('c-s1')
					got.push([b.from, b.until, b.remaining])
					svc.caseDraft('c-s1', summaryFor(svc.caseRaw('c-s1', 1, b.until), b), false)
				}
				return Promise.resolve({ ok: true, text: '' })
			},
		]
		svc.runNow('c-s1')
		await flush()
		assert.deepEqual(got, [[1, 5, 1], [6, 6, 0]])
	})

	it('название агента и заголовок — название последней сессии цепочки; нет сессии — заголовок кейса', async () => {
		sessions = [session('s1', { title: 'Релиз пакета 2' })]
		const svc = make()
		feed = [msg('s1')]
		observe(svc, 's1')
		svc.runNow('c-s1')
		await flush()
		assert.equal(calls[0]?.name, 'session-reliz-paketa-2')
		assert.equal(calls[0].title, 'Релиз пакета 2')
	})

	it('название кейса = название сессии: при заведении и при переименовании на тике; <meta> и правка описания его не меняют', async () => {
		sessions = [session('s1', { title: 'Первое название' })]
		const svc = make()
		feed = [msg('s1')]
		observe(svc, 's1')
		assert.equal(svc.getCase('c-s1').title, 'Первое название')
		events.length = 0
		// Claude переименовал чат (PATCH /sessions/:id {title}): кейс подхватывает без новых событий
		sessions = [session('s1', { title: 'Новое название' })]
		observe(svc, 's1')
		assert.equal(svc.getCase('c-s1').title, 'Новое название')
		assert.ok(events.some(e => e.t === 'learning_case' && e.case.title === 'Новое название'))
		// сборщик ответил с title в <meta>: название не меняется
		svc.runNow('c-s1')
		await flush()
		assert.equal(svc.getCase('c-s1').title, 'Новое название')
		assert.equal(calls[calls.length - 1]?.title, 'Новое название')
		// пустое название сессии — прежнее остаётся
		sessions = [session('s1', { title: '  ' })]
		observe(svc, 's1')
		assert.equal(svc.getCase('c-s1').title, 'Новое название')
	})

	it('промпт сборщика получает название сессии через {{session_title}}', async () => {
		store.prompts.set('session-collector', 'T={{session_title}}')
		sessions = [session('s1', { title: 'Релиз пакета 2' })]
		const svc = make()
		feed = [msg('s1')]
		observe(svc, 's1')
		svc.runNow('c-s1')
		await flush()
		assert.equal(calls[0]?.prompt, 'T=Релиз пакета 2')
	})

	it('maxAgents: 2, три кейса — третий ждёт queued, пока не освободится место', async () => {
		setSettings({ maxAgents: 2 })
		sessions = [session('s1'), session('s2'), session('s3')]
		const svc = make()
		feed = [msg('s1'), msg('s2'), msg('s3')]
		observe(svc, 's1')
		const gates = [gate(), gate(), gate()]
		script = gates.map(g => g.step)
		svc.runNow('s1')
		svc.runNow('s2')
		svc.runNow('s3')
		await flush()
		assert.deepEqual(jobs(svc).map(j => j.status), ['running', 'running', 'queued'])
		assert.equal(calls.length, 2)
		gates[0]?.release()
		await flush()
		assert.deepEqual(jobs(svc).map(j => j.status), ['done', 'running', 'running'])
		assert.equal(calls.length, 3)
		gates[1]?.release()
		gates[2]?.release()
		await flush()
		assert.ok(jobs(svc).every(j => j.status === 'done'))
	})

	it('рестарт: running → queued с note, исполнение с прежнего coveredUntil', async () => {
		const first = make()
		feed = Array.from({ length: 5 }, () => msg('s1'))
		observe(first, 's1')
		const c = first.getCase('c-s1')
		store.saveCase({ ...c, coveredUntil: 3 })
		const running: JobState = {
			id: 'j-old',
			kind: 'close',
			caseId: 'c-s1',
			subject: 'c-s1',
			status: 'running',
			attempts: 0,
			agentId: 'ag0',
			error: null,
			note: null,
			range: [4, 5],
			createdAt: new Date(T0).toISOString(),
			startedAt: new Date(T0).toISOString(),
			finishedAt: null,
			final: true,
			payload: null,
		}
		store.jobs = [running]
		store.prompts.set('session-collector', '{{mode}}|{{total}}|{{summary}}')
		const svc = make()
		assert.equal(jobs(svc)[0]?.status, 'queued')
		assert.equal(jobs(svc)[0]?.note, 'прервано перезапуском')
		assert.equal(store.jobs[0]?.status, 'queued')
		assert.equal(calls.length, 0)
		svc.start()
		await flush()
		assert.equal(calls.length, 1)
		assert.match(calls[0]?.prompt ?? '', /^final: .*\|2\|/) // всего событий после coveredUntil
		assert.equal(svc.getCase('c-s1').status, 'ready')
		await svc.stop()
	})

	it('enabled: false посреди running: задание доходит до конца, новых нет; disabledSessions: [s2] не мешает s1', async () => {
		sessions = [session('s1'), session('s2')]
		const svc = make()
		feed = [msg('s1'), msg('s2')]
		observe(svc, 's1')
		const g = gate()
		script = [g.step]
		svc.runNow('s1')
		await flush()
		assert.equal(jobs(svc)[0]?.status, 'running')
		calls = []
		setSettings({ enabled: false })
		feed.push(msg('s1'))
		clock.t += 40 * 60_000
		svc.touchJob('c-s1') // агент жив (читает блоки): сторож задание не снимает
		observe(svc, 's1')
		svc.onSessionClosed('s2')
		assert.equal(jobs(svc).length, 1)
		g.release()
		await flush()
		assert.equal(jobs(svc)[0]?.status, 'done')
		assert.equal(jobs(svc).length, 1)
		assert.equal(svc.getCase('c-s1').coveredUntil, 1)
		// явная команда работает и при выключенном
		const j = svc.runNow('s2')
		assert.equal(j.kind, 'close')
		await flush()
		assert.equal(svc.getCase('c-s2').status, 'ready')

		setSettings({ disabledSessions: ['s2'] })
		store.jobs = []
		store.cases.clear()
		const other = make()
		feed = [msg('s1'), msg('s2')]
		calls = []
		clock.t += 40 * 60_000
		observe(other, 's1')
		other.onSessionClosed('s2')
		other.onSessionClosed('s1')
		await flush()
		assert.equal(calls.length, 1)
		assert.ok(other.view().jobs.every(j => j.caseId === 'c-s1'))
		assert.equal(other.view().cases.some(c => c.id === 'c-s2'), false)
	})

	it('isProtected: true, пока кейс не ready', async () => {
		sessions = [session('s1'), session('s2')]
		const svc = make()
		feed = [msg('s1')]
		observe(svc, 's1')
		assert.equal(svc.isProtected('s1'), true) // collecting
		assert.equal(svc.isProtected('s2'), false) // кейса нет
		svc.onSessionClosed('s1')
		assert.equal(svc.isProtected('s1'), true) // closing
		await flush()
		assert.equal(svc.isProtected('s1'), false) // ready
	})

	it('close падает: задание остаётся running (слот за ним), кейс closing (не error), сессия защищена, повторы по retrySec без предела', async () => {
		const svc = make()
		feed = [msg('s1')]
		observe(svc, 's1')
		const bad: Reply = { ok: false, text: '', error: 'сбой' }
		drain = false
		script = [bad, bad, bad, bad]
		svc.onSessionClosed('s1')
		for (let i = 0; i < 3; i++) {
			await flush()
			await retry()
		}
		await flush()
		assert.equal(jobs(svc)[0]?.status, 'running')
		assert.ok((jobs(svc)[0]?.attempts ?? 0) >= 3)
		assert.equal(jobs(svc)[0]?.error, 'сбой')
		assert.equal(svc.getCase('c-s1').status, 'closing')
		assert.equal(svc.isProtected('s1'), true) // описание ещё не готово
	})

	it('кейс в error + активность и end: события собраны, close ставится; runNow возвращает в работу', async () => {
		const svc = make()
		feed = [msg('s1')]
		observe(svc, 's1')
		const c = svc.getCase('c-s1')
		store.saveCase({ ...c, status: 'error' })
		const svc2 = make()
		feed.push(msg('s1'))
		observe(svc2, 's1')
		assert.equal(svc2.getCase('c-s1').status, 'error')
		assert.equal(svc2.view().jobs.length, 0)
		svc2.runNow('c-s1')
		assert.equal(svc2.getCase('c-s1').status, 'closing')
		assert.equal(svc2.getCase('c-s1').events, 2) // runNow подбирает свежие события
		await flush()
		assert.equal(svc2.getCase('c-s1').status, 'ready')
	})

	it('final с пустой порцией: нет описания и событий — кейс удалён; есть описание — ready', async () => {
		const empty: CaseState = {
			id: 'c-e',
			title: null,
			sessions: ['e'],
			status: 'collecting',
			goals: [],
			events: 0,
			coveredUntil: 0,
			createdAt: new Date(T0).toISOString(),
			updatedAt: new Date(T0).toISOString(),
			closedAt: null,
			playbook: null,
			source: 'live',
			feedSeq: 0,
			transcripts: {},
			hinted: [],
			nextN: 1,
			lastEventAt: 0,
			lastRunAt: 0,
			nessyCalls: false,
		}
		store.saveCase(empty)
		store.saveCase({ ...empty, id: 'c-d', sessions: ['d'], events: 2, coveredUntil: 2 })
		store.summaries.set('c-d', '# Описание')
		sessions = []
		const svc = make()
		svc.runNow('c-e')
		svc.runNow('c-d')
		await flush()
		assert.equal(calls.length, 0) // агент не нужен
		assert.throws(() => svc.getCase('c-e'))
		assert.ok(!store.cases.has('c-e'))
		assert.ok(events.some(e => e.t === 'learning_case_removed' && e.id === 'c-e'))
		assert.equal(svc.getCase('c-d').status, 'ready')
		assert.ok(svc.getCase('c-d').closedAt)
		assert.ok(jobs(svc).every(j => j.status === 'done'))
	})

	it('stop: новых заданий не берёт, ждёт идущее', async () => {
		const svc = make()
		feed = [msg('s1'), msg('s2')]
		sessions = [session('s1'), session('s2')]
		observe(svc, 's1')
		const g = gate()
		script = [g.step]
		svc.start()
		svc.runNow('s1')
		await flush()
		let stopped = false
		const p = svc.stop().then(() => {
			stopped = true
		})
		await flush()
		assert.equal(stopped, false)
		svc.runNow('s2') // после stop насос не работает
		g.release()
		await p
		assert.equal(stopped, true)
		assert.equal(calls.length, 1)
		assert.equal(jobs(svc).find(j => j.caseId === 'c-s2')?.status, 'queued')
	})

	it('stop не ждёт дольше 5 с', async () => {
		{
			const svc = make()
			feed = [msg('s1')]
			observe(svc, 's1')
			script = [() => new Promise<Reply>(() => {})]
			svc.runNow('s1')
			let stopped = false
			const p = svc.stop().then(() => {
				stopped = true
			})
			await flush()
			assert.equal(stopped, false)
			mock.timers.tick(5000)
			await p
			assert.equal(stopped, true)
		}
	})
})
