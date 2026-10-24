/** Журнал обучения: события фонового обучения пишутся в него человеческим текстом (`kind: 'log'`). */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { JournalEntry, Message, SessionView } from '../../../shared/types'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { LearningHost } from '../../../src/application/learning/learning.types'
import { YOU } from '../../../src/domain/constants'
import { observe } from '../../support/signals'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'
import { drainReads } from '../../support/read-blocks'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')

const session = (id: string, title: string): SessionView => ({
	id,
	title,
	owner: null,
	status: 'active',
	summary: null,
	createdAt: new Date(T0 + 60_000).toISOString(),
	updatedAt: new Date(T0).toISOString(),
	sources: 0,
	chatId: `chat-${id}`,
})

let seq = 0
const msg = (s: string): Message => {
	seq += 1
	return { seq, id: `m${seq}`, ts: T0 + seq * 1000, from: YOU, to: 'a1', kind: 'msg', text: `текст ${seq}`, hops: 0, session: s }
}

const flush = async (): Promise<void> => {
	for (let i = 0; i < 5; i++) await new Promise<void>(r => setImmediate(r))
}

type Reply = { ok: boolean; text: string; error?: string }

describe('LearningService: журнал событий обучения', () => {
	let store: MemoryLearningStore
	let pstore: MemoryPlaybookStore
	let sessions: SessionView[]
	let feed: Message[]
	let script: Array<Reply | (() => Promise<Reply>)>
	let drain: boolean
	let current: LearningService | null = null
	const clock = { t: T0 + 60_000, now: () => clock.t }
	const host: LearningHost = {
		sessions: () => sessions,
		messagesSince: s => feed.filter(m => m.seq > s),
		lastSeq: () => 0,
		sessionOfMessage: m => m.session ?? null,
		isBusy: () => false,
		cancelAgent: () => Promise.resolve(),
		runAgent: async () => {
			if (drain) drainReads(current)
			const step = script.shift() ?? { ok: true, text: 'ок' }
			const r = typeof step === 'function' ? await step() : step
			return { agentId: 'ag1', ...r }
		},
	}
	const make = (withPlaybooks = true): LearningService => {
		const s = new LearningService({
			store,
			host,
			hub: new Hub(),
			clock,
			ids: { next: () => Math.random().toString(36).slice(2, 10) },
			defaultOn: true,
			claudeProjectsDir: '/p',
			...(withPlaybooks ? { playbookStore: pstore } : {}),
		})
		current = s
		s.load()
		return s
	}
	const logs = (): JournalEntry[] => pstore.journal.filter(e => e.kind === 'log')
	const texts = (): string[] => logs().map(e => e.summary)
	const has = (re: RegExp): JournalEntry | undefined => logs().find(e => re.test(e.summary))

	beforeEach(() => {
		seq = 0
		store = new MemoryLearningStore()
		store.prompts.set('session-collector', '{{mode}}|{{total}}|{{summary}}')
		pstore = new MemoryPlaybookStore()
		sessions = [session('s1', 'Починить вход')]
		feed = []
		script = []
		drain = true
		clock.t = T0 + 60_000
	})

	it('кейс заведён, задание стартовало и готово, блоки выданы и приняты, кейс готов — всё человеческим текстом с названием сессии', async () => {
		const svc = make()
		feed = [msg('s1'), msg('s1'), msg('s1')]
		observe(svc, 's1')
		assert.match(texts()[0] ?? '', /^Новая сессия «Починить вход»$/)
		assert.equal(logs()[0]?.subject, 'c-s1')
		assert.equal(logs()[0]?.level, 'info')
		assert.equal(logs()[0]?.revertible, false)
		assert.equal(logs()[0]?.report, null)
		clock.t += 5_000
		svc.runNow('c-s1')
		await flush()
		assert.ok(has(/^Итоговое описание «Починить вход»: агент запущен, попытка 1$/))
		assert.ok(has(/^«Починить вход»: блок 1 — события 1–3$/))
		assert.ok(has(/^«Починить вход»: саммари блока 1 принято, 3 из 3$/))
		assert.ok(has(/^«Починить вход»: итоговое описание принято$/))
		assert.ok(has(/^Итоговое описание «Починить вход»: готово за \d+ с$/))
		assert.ok(has(/^Сессия «Починить вход» обработана: 3 события, 1 цель$/))
		// id в человеческом тексте нет
		assert.ok(!texts().some(t => /c-s1|j-/.test(t)))
	})

	it('провал задания: warn с причиной и паузой повтора, слот остаётся за заданием', async () => {
		const svc = make()
		feed = [msg('s1')]
		observe(svc, 's1')
		drain = false
		script = [{ ok: false, text: '', error: 'таймаут' }]
		svc.runNow('c-s1')
		await flush()
		const fail = has(/не удалось: таймаут/)
		assert.ok(fail)
		assert.equal(fail.level, 'warn')
		assert.match(fail.summary, /^Итоговое описание «Починить вход»: не удалось: таймаут; повтор через 1 мин$/)
		assert.deepEqual(
			svc.view().jobs.map(j => j.status),
			['running'],
		)
		await svc.stop()
	})

	it('блок отклонён: warn с кодом правила; остановка пользователем и удаление кейса с надгробием', async () => {
		const svc = make()
		feed = [msg('s1'), msg('s1')]
		observe(svc, 's1')
		let release = (): void => undefined
		drain = false
		script = [() => new Promise<Reply>(r => (release = () => r({ ok: true, text: '' })))]
		svc.runNow('c-s1')
		await flush()
		svc.caseRead('c-s1')
		assert.throws(() => svc.caseDraft('c-s1', '# плохо'), /REJECTED/)
		const rej = has(/саммари блока 1 отклонено/)
		assert.ok(rej)
		assert.equal(rej.level, 'warn')
		assert.match(rej.summary, /^«Починить вход»: саммари блока 1 отклонено \(попытка 1\/3\): R\d/)
		const job = svc.view().jobs.find(j => j.status === 'running')
		assert.ok(job)
		svc.cancelJob(job.id)
		assert.ok(has(/остановка по просьбе пользователя/))
		release()
		await flush()
		assert.ok(has(/Итоговое описание «Починить вход»: остановлено пользователем/))
		svc.removeCase('c-s1')
		assert.ok(has(/^Сессия «Починить вход» удалена из обучения/))
		assert.ok(has(/поставлено надгробие/))
	})

	it('запуск, остановка и включение/выключение обучения; работа задания после рестарта', async () => {
		const svc = make()
		svc.start()
		assert.match(texts()[0] ?? '', /^Фоновое обучение запущено: кейсов 0, заданий в работе и очереди 0$/)
		svc.updateSettings({ enabled: false })
		assert.ok(has(/^Фоновое обучение выключено$/))
		svc.updateSettings({ enabled: true })
		assert.ok(has(/^Фоновое обучение включено$/))
		await svc.stop()
		assert.ok(has(/^Фоновое обучение остановлено$/))
		// прерванное перезапуском задание
		store.jobs = [
			{
				id: 'j-x',
				kind: 'close',
				caseId: '',
				subject: 'c-s1',
				status: 'running',
				attempts: 0,
				agentId: null,
				error: null,
				note: null,
				range: null,
				title: null,
				createdAt: new Date(T0).toISOString(),
				startedAt: new Date(T0).toISOString(),
				finishedAt: null,
				final: true,
				payload: null,
			},
		]
		pstore.journal.length = 0
		make()
		assert.match(texts()[0] ?? '', /: прервано перезапуском, продолжаю$/)
		assert.equal(logs()[0]?.level, 'warn')
	})

	it('без хранилища плейбуков журнал молча пропускается', async () => {
		const svc = make(false)
		feed = [msg('s1')]
		observe(svc, 's1')
		svc.runNow('c-s1')
		await flush()
		svc.log('error', '', 'что-то')
		assert.equal(pstore.journal.length, 0)
		assert.equal(svc.getCase('c-s1').status, 'ready')
	})
})
