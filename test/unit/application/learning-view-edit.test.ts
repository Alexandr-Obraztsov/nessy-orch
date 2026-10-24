/** Просмотр и правка блоками (этап 3): задание с ответами, raw, summary, остановка сборщика, impact, документ плейбука. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { beforeEach, describe, it } from 'node:test'
import type { HubEvent, RawEvent } from '../../../shared/types'
import { AppError } from '../../../src/domain/errors'
import { Hub } from '../../../src/application/hub'
import { LearningService } from '../../../src/application/learning/learning.service'
import type { CaseState, JobState, LearningHost, PlaybookState } from '../../../src/application/learning/learning.types'
import { MemoryLearningStore } from '../../support/memory-learning-store'
import { drainReads } from '../../support/read-blocks'
import { MemoryPlaybookStore } from '../../support/memory-playbook-store'
import { samplePlaybook } from '../../support/sample-playbook'

const sha = (t: string): string => createHash('sha1').update(t).digest('hex')
const T0 = Date.parse('2026-10-01T10:00:00.000Z')
const flush = async (): Promise<void> => {
	for (let i = 0; i < 20; i++) await new Promise<void>(r => setImmediate(r))
}
const GOOD = '<summary>\n# T\n</summary>\n<meta>{"title":"T","goals":[]}</meta>'

const baseCase = (id: string, over: Partial<CaseState> = {}): CaseState => ({
	id,
	title: 'Case',
	sessions: [id],
	status: 'collecting',
	goals: [],
	events: 10,
	coveredUntil: 0,
	createdAt: new Date(T0).toISOString(),
	updatedAt: new Date(T0).toISOString(),
	closedAt: null,
	playbook: null,
	source: 'live',
	feedSeq: 5,
	transcripts: {},
	nextN: 11,
	lastEventAt: 0,
	lastRunAt: 0,
	nessyCalls: false,
	hinted: [],
	...over,
})
const raw = (n: number): RawEvent => ({ n, ts: T0 + n, kind: 'user', from: 'you', to: 'a1', text: `событие ${n}`, ref: `m${n}` })

describe('LearningService: просмотр и правка блоками', () => {
	let store: MemoryLearningStore
	let pstore: MemoryPlaybookStore
	let events: HubEvent[]
	let hold: Promise<void> | null
	let cancelled: string[]
	let current: LearningService | null = null
	const host: LearningHost = {
		sessions: () => [],
		messagesSince: () => [],
		lastSeq: () => 0,
		sessionOfMessage: () => null,
		isBusy: () => false,
		cancelAgent: id => {
			cancelled.push(id)
			return Promise.resolve()
		},
		runAgent: async req => {
			req.onSpawn?.('ag-live')
			if (hold) await hold
			// остановленный агент блоков уже не принимает
			if (!cancelled.length) drainReads(current)
			return { agentId: 'ag-live', ok: true, text: GOOD }
		},
	}
	const make = (): LearningService => {
		const hub = new Hub()
		hub.subscribe(e => events.push(e))
		const svc = new LearningService({
			store,
			host,
			hub,
			clock: { now: () => T0 + 3_600_000 },
			ids: { next: () => Math.random().toString(36).slice(2, 10) },
			defaultOn: true,
			claudeProjectsDir: '/p',
			playbookStore: pstore,
		})
		current = svc
		svc.load()
		svc.start()
		return svc
	}
	const seedPlaybook = (over: Partial<PlaybookState> = {}): PlaybookState => {
		const p: PlaybookState = { ...samplePlaybook(), verdicts: {}, rejectedEdits: [], reviewAttempts: 0, ...over }
		pstore.snapshots.set(p.id, [{ state: p, files: {}, ts: '2026-10-01T00:00:00Z', message: 'init' }])
		return p
	}
	const job = (over: Partial<JobState>): JobState => ({
		id: 'j-1',
		kind: 'collect',
		caseId: 'c-1',
		subject: 'c-1',
		status: 'done',
		attempts: 0,
		agentId: null,
		error: null,
		note: null,
		range: null,
		createdAt: new Date(T0).toISOString(),
		startedAt: null,
		finishedAt: null,
		final: false,
		payload: null,
		...over,
	})

	beforeEach(() => {
		store = new MemoryLearningStore()
		pstore = new MemoryPlaybookStore()
		store.prompts.set('session-collector', '{{mode}}|{{range}}|{{summary}}')
		events = []
		hold = null
		cancelled = []
	})

	it('jobDetail: ответы по порядку k (10 после 2), чужие задания не попадают; нет задания — 404', () => {
		store.cases.set('c-1', baseCase('c-1', { status: 'ready' }))
		store.jobs = [job({ id: 'j-1' })]
		store.runs.set('c-1/j-1-2', 'второй')
		store.runs.set('c-1/j-1-10', 'десятый')
		store.runs.set('c-1/j-1-1', 'первый')
		store.runs.set('c-1/j-2-1', 'чужой')
		const svc = make()
		const d = svc.jobDetail('j-1')
		assert.equal(d.job.id, 'j-1')
		assert.deepEqual(d.runs, [
			{ name: 'j-1-1', text: 'первый' },
			{ name: 'j-1-2', text: 'второй' },
			{ name: 'j-1-10', text: 'десятый' },
		])
		assert.deepEqual(svc.jobDetail('j-1').job, d.job)
		assert.throws(() => svc.jobDetail('j-x'), { code: 'no_job', status: 404 })
	})

	it('caseRaw: диапазон включительно, без to — до конца, не больше 500; нет кейса — 404', () => {
		store.cases.set('c-1', baseCase('c-1'))
		store.raw.set(
			'c-1',
			Array.from({ length: 600 }, (_, i) => raw(i + 1)),
		)
		store.cases.set('c-1', baseCase('c-1', { nextN: 601 }))
		const svc = make()
		assert.deepEqual(
			svc.caseRaw('c-1', 3, 5).map(e => e.n),
			[3, 4, 5],
		)
		assert.equal(svc.caseRaw('c-1', 0).length, 500)
		assert.equal(svc.caseRaw('c-1', 590).length, 11)
		assert.throws(() => svc.caseRaw('c-x', 0), { code: 'no_case', status: 404 })
	})

	it('setCaseSummary: пишет summary.md, курсор цел; running-задание — 409 case_busy; нет кейса — 404', async () => {
		store.cases.set('c-1', baseCase('c-1'))
		store.summaries.set('c-1', '# Old')
		store.raw.set('c-1', [raw(1)])
		const svc = make()
		const before = svc.getCase('c-1')
		svc.setCaseSummary('c-1', '# New', sha('# Old'))
		assert.equal(store.summaries.get('c-1'), '# New')
		const after = svc.getCase('c-1')
		assert.deepEqual([after.coveredUntil, after.nextN, after.feedSeq, after.status], [before.coveredUntil, before.nextN, before.feedSeq, before.status])
		assert.throws(() => svc.setCaseSummary('c-x', 'x', sha('')), { code: 'no_case', status: 404 })
		let release = (): void => {}
		hold = new Promise<void>(r => {
			release = r
		})
		svc.runNow('c-1')
		await flush()
		assert.throws(() => svc.setCaseSummary('c-1', 'x', sha('# New')), { code: 'case_busy', status: 409 })
		release()
		await flush()
		svc.setCaseSummary('c-1', '# Again', sha(store.summaries.get('c-1') ?? ''))
		assert.equal(store.summaries.get('c-1'), '# Again')
	})

	it('stopCollector: running — агент отменён, итог не пишется, задание done «остановлено» после возврата обработчика; кейс не запечатывается', async () => {
		store.cases.set('c-1', baseCase('c-1'))
		store.raw.set('c-1', [raw(1)])
		store.summaries.set('c-1', '# Есть описание')
		const svc = make()
		let release = (): void => {}
		hold = new Promise<void>(r => {
			release = r
		})
		svc.runNow('c-1')
		await flush()
		const running = svc.view().jobs.find(j => j.status === 'running')
		assert.equal(running?.agentId, 'ag-live')
		svc.stopCollector('c-1')
		assert.deepEqual(cancelled, ['ag-live'])
		assert.equal(svc.getCase('c-1').status, 'collecting')
		release()
		await flush()
		const done = svc.view().jobs.find(j => j.id === running.id)
		assert.deepEqual([done?.status, done?.note, done?.error, done?.attempts], ['done', 'остановлено', null, 0])
		// поздний ответ агента игнорируется: описание прежнее, курсор не двигался, ответ в runs не пишется
		assert.equal(store.summaries.get('c-1'), '# Есть описание')
		assert.equal(svc.getCase('c-1').coveredUntil, 0)
		assert.equal(svc.getCase('c-1').status, 'collecting')
		assert.equal(store.runs.size, 0)
		assert.deepEqual(
			svc.view().jobs.filter(j => j.status === 'queued'),
			[],
		)
	})

	it('stopCollector: close в работе — кейс closing → collecting, не удаляется даже без описания; без заданий сборки — ничего', async () => {
		store.cases.set('c-1', baseCase('c-1'))
		store.cases.set('c-2', baseCase('c-2', { status: 'ready' }))
		store.raw.set('c-1', [raw(1)])
		const svc = make()
		let release = (): void => {}
		hold = new Promise<void>(r => {
			release = r
		})
		svc.rebuild('c-1')
		await flush()
		assert.equal(svc.getCase('c-1').status, 'closing')
		svc.stopCollector('c-1')
		release()
		await flush()
		assert.equal(svc.getCase('c-1').status, 'collecting')
		assert.equal(svc.getCase('c-1').closedAt, null)
		assert.equal(
			events.some(e => e.t === 'learning_case_removed'),
			false,
		)
		svc.stopCollector('c-2')
		assert.equal(svc.getCase('c-2').status, 'ready')
		assert.throws(() => svc.stopCollector('c-x'), { code: 'no_case', status: 404 })
	})

	it('cancelJob: queued → done «остановлено»; running любого вида — отмена агента, done после возврата, без повторов; нет задания — 404', async () => {
		seedPlaybook({ status: 'draft' })
		for (const id of ['c1', 'c2', 'c3']) store.cases.set(id, baseCase(id, { status: 'ready' }))
		const svc = make()
		let release = (): void => {}
		hold = new Promise<void>(r => {
			release = r
		})
		const rv = svc.requestReview('p-1')
		await flush()
		assert.equal(svc.view().jobs.find(j => j.id === rv.id)?.status, 'running')
		svc.postChat('p-1', 'правка')
		await flush()
		const q = svc.view().jobs.find(j => j.kind === 'edit')
		assert.equal(q?.status, 'queued')
		svc.cancelJob(q.id)
		assert.deepEqual([svc.view().jobs.find(j => j.id === q.id)?.status, svc.view().jobs.find(j => j.id === q.id)?.note], ['done', 'остановлено'])
		svc.cancelJob(rv.id)
		assert.deepEqual(cancelled, ['ag-live'])
		assert.equal(svc.view().jobs.find(j => j.id === rv.id)?.status, 'running')
		release()
		await flush()
		const done = svc.view().jobs.find(j => j.id === rv.id)
		assert.deepEqual([done?.status, done?.note, done?.error, done?.attempts], ['done', 'остановлено', null, 0])
		assert.equal(svc.playbooks?.get('p-1')?.version, 1)
		assert.equal(
			svc.view().jobs.some(j => j.status === 'queued' || j.status === 'error'),
			false,
		)
		assert.throws(() => svc.cancelJob('j-x'), { code: 'no_job', status: 404 })
	})

	it('caseImpact: единственное доказательство → evidenceLeft 0, с другим кейсом → 1; архивные и чужие не считаются', () => {
		store.cases.set('c1', baseCase('c1', { status: 'ready' }))
		store.cases.set('c2', baseCase('c2', { status: 'ready' }))
		seedPlaybook()
		const svc = make()
		const impact = svc.caseImpact('c1')
		// r1: c1 + c2 → 1; r2: только c1 → 0
		assert.deepEqual(
			impact.rules.map(r => [r.ruleId, r.evidenceLeft]),
			[
				['r1', 1],
				['r2', 0],
			],
		)
		assert.equal(impact.rules[0]?.playbookId, 'p-1')
		assert.equal(impact.rules[0].text, 'Run lint')
		// c2 — доказательство только r1, и там остаётся c1
		assert.deepEqual(
			svc.caseImpact('c2').rules.map(r => [r.ruleId, r.evidenceLeft]),
			[['r1', 1]],
		)
		// неизвестный кейс среди доказательств не считается «оставшимся»
		assert.throws(() => svc.caseImpact('c-x'), { code: 'no_case', status: 404 })
	})

	const markdownOf = (id = 'p-1'): string => svcDetail(id).markdown
	let svcRef: LearningService | null = null
	const svcDetail = (id: string): { markdown: string; version: number } => {
		const d = svcRef?.playbookDetail(id)
		if (!d) throw new Error('нет сервиса')
		return d
	}
	const makeWithCases = (): LearningService => {
		store.cases.set('c1', baseCase('c1', { status: 'ready' }))
		store.cases.set('c2', baseCase('c2', { status: 'ready' }))
		seedPlaybook()
		svcRef = make()
		return svcRef
	}

	it('putPlaybookMarkdown: удаление этапа — новая версия без файла этапа, n по порядку, журнал edit с версией', () => {
		const svc = makeWithCases()
		const md = markdownOf()
		const cut = md.slice(0, md.indexOf('### 1. Research')) + md.slice(md.indexOf('### 2. Implement')).replace('### 2. Implement', '### 7. Implement')
		const d = svc.putPlaybookMarkdown('p-1', cut, 1)
		assert.equal(d.version, 2)
		assert.deepEqual(
			d.stages.map(s => [s.n, s.slug]),
			[[1, 'implement']],
		)
		const files = Object.keys(pstore.snapshots.get('p-1')?.at(-1)?.files ?? {})
		assert.ok(files.includes('stages/01-implement.md'))
		assert.ok(!files.some(f => f.includes('research')))
		const entry = pstore.journal.filter(e => e.kind === 'edit').at(-1)
		assert.ok(entry)
		assert.equal(entry.revertible, true)
		assert.equal((JSON.parse(entry.report ?? '{}') as { version: number }).version, 2)
		assert.ok(events.some(e => e.t === 'learning_playbook'))
		assert.match(d.markdown, /### 1\. Implement/)
	})

	it('putPlaybookMarkdown: пустой description — 400 lint (замечания через перевод строки); нет плейбука — 404', () => {
		const svc = makeWithCases()
		const bad = markdownOf().replace(/^description: .*$/m, 'description: ""')
		assert.throws(
			() => svc.putPlaybookMarkdown('p-1', bad, 1),
			(e: unknown) => e instanceof AppError && e.code === 'lint' && e.status === 400 && e.message.includes('description'),
		)
		assert.throws(() => svc.putPlaybookMarkdown('p-1', markdownOf().replace('Use when implementing', 'Implementing'), 1), { code: 'lint', status: 400 })
		assert.equal(svc.playbooks?.get('p-1')?.version, 1)
		assert.throws(() => svc.putPlaybookMarkdown('p-x', 'x', 1), { code: 'no_playbook', status: 404 })
	})

	it('putPlaybookMarkdown: правка текста сохраняет счётчики; пропавший маркер — архив; строка без маркера — активное правило user', () => {
		const svc = makeWithCases()
		const md = markdownOf()
			.replace('- Run lint <!--', '- Run lint and tests <!--')
			.replace(/^- Maybe <!-- r2 -->\n/m, '')
			.replace('### Candidates', '- Brand new rule\n\n### Candidates')
		const d = svc.putPlaybookMarkdown('p-1', md, 1)
		const r1 = d.rules.find(r => r.id === 'r1')
		assert.deepEqual([r1?.text, r1?.up, r1?.down, r1?.status, r1?.evidence.length], ['Run lint and tests', 3, 1, 'active', 2])
		assert.equal(d.rules.find(r => r.id === 'r2')?.status, 'archived')
		const fresh = d.rules.find(r => r.text === 'Brand new rule')
		assert.deepEqual([fresh?.status, fresh?.up, fresh?.down, fresh?.author], ['active', 2, 0, 'user'])
		assert.match(fresh?.id ?? '', /^r-/)
		assert.ok(pstore.journal.some(e => e.kind === 'rule_activated' && e.summary.includes('добавлено вручную')))
		assert.doesNotMatch(d.markdown, /Maybe/)
	})

	it('putPlaybookMarkdown: по плейбуку идёт задание — 409 playbook_busy', async () => {
		seedPlaybook({ status: 'draft' })
		for (const id of ['c1', 'c2', 'c3']) store.cases.set(id, baseCase(id, { status: 'ready' }))
		const svc = make()
		svcRef = svc
		let release = (): void => {}
		hold = new Promise<void>(r => {
			release = r
		})
		svc.requestReview('p-1')
		await flush()
		assert.throws(() => svc.putPlaybookMarkdown('p-1', markdownOf(), 1), { code: 'playbook_busy', status: 409 })
		release()
	})

	it('putPlaybookMarkdown: baseVersion не совпала — 409 stale с текущей версией, плейбук не меняется', () => {
		const svc = makeWithCases()
		const md = markdownOf()
		assert.throws(
			() => svc.putPlaybookMarkdown('p-1', md, 3),
			(e: unknown) => e instanceof AppError && e.status === 409 && e.code === 'stale' && e.extra?.['version'] === 1,
		)
		assert.equal(svc.playbooks?.get('p-1')?.version, 1)
		assert.equal(svc.putPlaybookMarkdown('p-1', md.replace('Implement aff package', 'New'), 1).version, 2)
		assert.throws(() => svc.putPlaybookMarkdown('p-1', md, 1), { code: 'stale', status: 409 })
	})

	it('setCaseSummary: base не совпал — 409 stale, файл цел; после записи goals из текста (title не трогается), updatedAt и событие learning_case', () => {
		store.cases.set('c-1', baseCase('c-1', { title: 'Старое', goals: [{ title: 'old', type: 'x' }] }))
		store.summaries.set('c-1', '# Old')
		const svc = make()
		assert.throws(() => svc.setCaseSummary('c-1', '# New', sha('другое')), { code: 'stale', status: 409 })
		assert.equal(store.summaries.get('c-1'), '# Old')
		assert.equal(svc.getCaseDetail('c-1').summaryHash, sha('# Old'))
		events.length = 0
		const text = '# Новый заголовок\nпредисловие\n## Goal: Починить сборку (type: fix-build)\n### Actions\n- a\n## Goal: Без типа\n'
		svc.setCaseSummary('c-1', text, sha('# Old'))
		const c = svc.getCase('c-1')
		assert.equal(c.title, 'Старое', 'название кейса — название сессии, правка описания его не меняет')
		assert.deepEqual(c.goals, [
			{ title: 'Починить сборку', type: 'fix-build' },
			{ title: 'Без типа', type: '' },
		])
		assert.equal(c.updatedAt, new Date(T0 + 3_600_000).toISOString())
		assert.equal(events.filter(e => e.t === 'learning_case').length, 1)
		assert.equal(svc.getCaseDetail('c-1').summaryHash, sha(text))
		svc.setCaseSummary('c-1', 'просто текст', sha(text))
		assert.equal(svc.getCase('c-1').title, 'Старое')
		assert.deepEqual(svc.getCase('c-1').goals, [])
	})

	it('view().rev — номер шины на момент ответа; события learning_* несут rev', () => {
		store.cases.set('c-1', baseCase('c-1'))
		store.summaries.set('c-1', '# Old')
		const svc = make()
		const r0 = svc.view().rev
		svc.setCaseSummary('c-1', '# New', sha('# Old'))
		const ev = events.find(e => e.t === 'learning_case')
		assert.ok(ev)
		assert.equal(ev.rev, r0 + 1)
		assert.equal(svc.view().rev, r0 + 1)
	})
})
