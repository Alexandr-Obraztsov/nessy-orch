/** Плейбуки, сквозной сценарий: 3 сессии → кейсы → сопоставление → сборка → ревью → trial → плагин; журнал, откат, чат, CLI, права. */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { ApiError, CaseDetail, CaseImpact, ChatMessage, JobDetail, JournalEntry, LearningView, RawEvent, PlaybookDetail, PlaybookView, SessionView, SpawnResponse } from '../../shared/types'
import { startHarness } from '../support/harness'
import { repoRoot } from '../support/repo-root'
import type { Harness } from '../support/support.types'
import { until } from '../support/wait'

const T = { timeout: 120000 }
const CLI_MAIN = path.join(__dirname, '..', '..', 'src', 'interfaces', 'cli', 'main.js')
const COLLECT = '<summary>\n# Review MR\n## Goal: review a merge request in GitLab (type: review-mr)\n### Actions\n- read the merge request diff\n- write review comments\n</summary>\n<meta>{"title":"Review MR","goals":[{"title":"review a merge request","type":"review-mr"}]}</meta>\nСтатус: DONE'
const result = (o: unknown): string => `Итог\n<result>\n${JSON.stringify(o)}\n</result>\nСтатус: ok`
const GOOD = result({ critical: [], notes: [] })
const DRAFT = {
	title: 'Review merge request',
	description: 'Use when reviewing a merge request in GitLab',
	taskType: 'review-mr',
	cases: [],
	heldOut: null,
	params: [],
	sources: ['GitLab'],
	files: [],
	behavior: [],
	stages: [{ n: 1, slug: 'read', title: 'Read the diff', role: null, where: 'GitLab', produce: 'notes', done: 'diff read', gate: false, template: 'Read the diff of the merge request' }],
	rules: [],
}

describe('плейбуки (сквозной)', () => {
	let h: Harness | null = null
	let base = ''
	let prevHome: string | undefined

	beforeEach(() => {
		base = fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-orch-pb-'))
		fs.mkdirSync(path.join(base, 'home'), { recursive: true })
		prevHome = process.env['NESSY_ORCH_HOME']
		process.env['NESSY_ORCH_HOME'] = path.join(base, 'home')
	})
	afterEach(async () => {
		await h?.close()
		h = null
		if (prevHome === undefined) delete process.env['NESSY_ORCH_HOME']
		else process.env['NESSY_ORCH_HOME'] = prevHome
		fs.rmSync(base, { recursive: true, force: true })
	})

	const scenarios = (v: Record<string, string>): void => fs.writeFileSync(path.join(base, 'home', 'fake-scenarios.json'), JSON.stringify(Object.fromEntries(Object.entries(v).map(([k, t]) => [k, [{ text: t }]]))))
	const CLI = path.join(repoRoot(), 'bin', 'nessy-orch')
	const cli = (hh: Harness, ...args: string[]): Promise<{ code: number; out: string }> =>
		new Promise(resolve => {
			execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ORCH_PORT: String(hh.port), NO_COLOR: '1' } }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, out: stdout + stderr }))
		})

	it('3 сессии → плейбук trial в плагине; откат записи; чат правит и пишет заметку; CLI', T, async () => {
		const collect = { 'SESSION COLLECTOR': COLLECT }
		scenarios(collect)
		h = await startHarness({ base, config: { learningDefaultOn: true } })
		const hh = h
		assert.equal((await hh.api('PATCH', '/learning/settings', { autoReview: true })).status, 200)
		assert.equal((await hh.api('POST', '/spaces', { path: hh.ws, name: 'main' })).status, 201)
		// сессии создаются после старта сервиса (точка отсчёта), цели у всех одного типа
		const ids: string[] = []
		for (let i = 0; i < 3; i++) {
			const s = (await hh.api<SessionView>('POST', '/sessions', { title: `Ревью ${i}` })).body
			const r = await hh.api<SpawnResponse>('POST', '/agents', { space: 'main', name: `worker${i}`, session: s.id, prompt: `проверь merge request ${i}`, wait: true })
			assert.equal(r.status, 201)
			ids.push(`c-${s.id}`)
		}
		const evidence = ids.map(caseId => ({ caseId, anchor: 'n 1' }))
		const group = { task: 'review a merge request', taskType: 'review-mr', playbookId: null, cases: evidence }
		scenarios({
			...collect,
			'# PLAYBOOK MATCHER': result({ groups: [group] }),
			'# PLAYBOOK BUILDER': result({ ...DRAFT, rules: [{ text: 'Run lint before review', stage: 1, evidence }] }),
			'# PLAYBOOK GRADER': GOOD,
			'# PLAYBOOK REVIEWER': GOOD,
			'# PLAYBOOK CONSISTENCY': GOOD,
			'# TASK PLANNER': result({ plan: 'plan' }),
			'# BLIND COMPARATOR': result({ winner: 'tie', reason: 'same' }),
			'# PLAYBOOK SELECTOR': result({ playbookId: 'p-review-mr' }),
		})
		for (const id of ids) assert.equal((await hh.api('POST', `/sessions/${id.slice(2)}/closed`)).status, 200)

		const learning = hh.orch.learning
		assert.ok(learning)
		await until(() => learning.view().playbooks.some(p => p.status === 'trial'), 90000, 'плейбук trial')
		const view = (await hh.api<LearningView>('GET', '/learning')).body
		const pb = view.playbooks[0]
		assert.ok(pb)
		assert.equal(pb.id, 'p-review-mr')
		assert.equal(pb.heldOut !== null && pb.cases.length === 2, true)
		const plugin = path.join(hh.base, 'plugin', 'nessy-playbooks')
		assert.ok(fs.existsSync(path.join(plugin, '.claude-plugin', 'plugin.json')))
		assert.match(fs.readFileSync(path.join(plugin, 'skills', pb.id, 'SKILL.md'), 'utf8'), /Use when reviewing a merge request/)
		// ответы агентов не-кейсовых заданий лежат вне cases/
		assert.ok(fs.existsSync(path.join(hh.home, 'learning', 'runs', 'all')))
		assert.ok(fs.readdirSync(path.join(hh.home, 'cases')).every(d => d.startsWith('c-')))

		const detail = (await hh.api<PlaybookDetail>('GET', `/learning/playbooks/${pb.id}`)).body
		assert.equal(detail.reviews.length >= 1, true)
		assert.equal(detail.reviews.at(-1)?.passed, true)

		const ls = await cli(hh, 'playbook', 'ls')
		assert.equal(ls.code, 0)
		assert.match(ls.out, /p-review-mr/)
		assert.match(ls.out, /trial/)
		assert.match((await cli(hh, 'playbook', 'show', pb.id)).out, /Run lint before review/)

		// откат решения «ревью пройдено» → плейбук снова draft, плагин пуст
		const journal = (await hh.api<JournalEntry[]>('GET', '/learning/journal')).body
		const passed = journal.find(e => e.kind === 'review_passed' && e.revertible)
		assert.ok(passed)
		assert.equal((await hh.api('POST', `/learning/journal/${passed.id}/revert`, {})).status, 200)
		assert.equal(fs.existsSync(plugin), false)
		assert.equal((await hh.api<PlaybookView[]>('GET', '/learning/playbooks')).body[0]?.status, 'draft')

		// чат: правка правила и постоянная заметка
		const rulesFile = path.join(hh.home, 'playbooks', pb.id, 'files', 'rules.md')
		const rules = fs.readFileSync(rulesFile, 'utf8')
		scenarios({ '# PLAYBOOK EDITOR': result({ files: { 'rules.md': rules.replace('Run lint before review', 'Run lint and tests before review') }, note: 'always check X', summary: 'Rule extended' }) })
		const before = learning.playbooks?.detail(pb.id).versions.length ?? 0
		const posted = await hh.api<ChatMessage>('POST', `/learning/chat/${pb.id}`, { text: 'always check X' })
		assert.equal(posted.status, 200)
		await until(() => (learning.playbooks?.detail(pb.id).versions.length ?? 0) > before, 60000, 'новая версия после чата')
		const after = (await hh.api<PlaybookDetail>('GET', `/learning/playbooks/${pb.id}`)).body
		assert.match(after.rules[0]?.text ?? '', /and tests/)
		assert.match(fs.readFileSync(path.join(hh.home, 'playbooks', pb.id, 'notes.md'), 'utf8'), /- \d{4}-\d\d-\d\d: always check X/)
		await until(() => learning.chatOf(pb.id).length === 2, 20000, 'ответ в чате')
		assert.deepEqual((await hh.api<ChatMessage[]>('GET', `/learning/chat/${pb.id}`)).body.map(m => m.from), ['user', 'agent'])
		assert.equal((await hh.api<ApiError>('GET', '/learning/chat/zzz')).status, 400)
	})

	it('hook prompt: плейбук active подсказывается один раз; skill = каталог плагина = name в SKILL.md', T, async () => {
		h = await startHarness({ base, config: { learningDefaultOn: true } })
		const hh = h
		const learning = hh.orch.learning
		assert.ok(learning?.playbooks)
		const pb = learning.playbooks.create(DRAFT, { task: 'review a merge request', taskType: 'review-mr', playbookId: null, cases: [] }, null)
		learning.playbooks.setStatus(pb.id, 'active', 'тест')
		const session = (await hh.api<SessionView>('POST', '/sessions', { title: 'Подсказка' })).body
		const prompt = (text: string): Promise<{ code: number | null; out: string }> =>
			new Promise(resolve => {
				const p = spawn(process.execPath, [CLI_MAIN, 'hook', 'prompt'], { env: { ...process.env, ORCH_PORT: String(hh.port), NO_COLOR: '1', NESSY_ORCH_SESSION: session.id } })
				let out = ''
				p.stdout.on('data', (d: Buffer) => (out += d.toString()))
				p.on('close', code => resolve({ code, out }))
				p.stdin.end(JSON.stringify({ prompt: text }))
			})
		const ask = 'please review a merge request in GitLab'
		const first = await prompt(ask)
		assert.equal(first.code, 0)
		const ctx = (JSON.parse(first.out) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }).hookSpecificOutput
		assert.equal(ctx.hookEventName, 'UserPromptSubmit')
		assert.match(ctx.additionalContext, new RegExp(`nessy-playbooks:${pb.id}`))
		const second = await prompt(ask)
		assert.equal(second.code, 0)
		assert.equal(second.out, '')
		// имя скилла = каталог в плагине = name во frontmatter
		const hint = (await hh.api<{ playbook: { id: string; skill: string } | null }>('POST', '/learning/hint', { session: 'another', prompt: ask })).body
		assert.equal(hint.playbook?.skill, `nessy-playbooks:${pb.id}`)
		const dir = path.join(hh.base, 'plugin', 'nessy-playbooks', 'skills', pb.id)
		assert.match(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), new RegExp(`^---\\n(?:[^\\n]*\\n)*?name: ${pb.id}\\n`))
	})

	it('просмотр и правка блоками по HTTP: задание с ответами, raw, summary, impact, PATCH, остановка сборщика', T, async () => {
		scenarios({ 'SESSION COLLECTOR': COLLECT })
		h = await startHarness({ base, config: { learningDefaultOn: true } })
		const hh = h
		assert.equal((await hh.api('POST', '/spaces', { path: hh.ws, name: 'main' })).status, 201)
		const ids: string[] = []
		for (let i = 0; i < 2; i++) {
			const s = (await hh.api<SessionView>('POST', '/sessions', { title: `Ревью ${i}` })).body
			assert.equal((await hh.api<SpawnResponse>('POST', '/agents', { space: 'main', name: `worker${i}`, session: s.id, prompt: `проверь merge request ${i}`, wait: true })).status, 201)
			ids.push(`c-${s.id}`)
			assert.equal((await hh.api('POST', `/sessions/${s.id}/closed`)).status, 200)
		}
		const learning = hh.orch.learning
		assert.ok(learning?.playbooks)
		await until(() => ids.every(id => learning.view().cases.find(c => c.id === id)?.status === 'ready'), 60000, 'кейсы ready')
		const [c1, c2] = ids
		assert.ok(c1 && c2)

		// задание сборки: ответ агента лежит в runs/
		const job = learning.view().jobs.find(j => j.caseId === c1 && j.kind === 'close')
		assert.ok(job)
		const detail = await hh.api<JobDetail>('GET', `/learning/jobs/${job.id}`)
		assert.equal(detail.status, 200)
		assert.equal(detail.body.job.id, job.id)
		assert.deepEqual(detail.body.runs.map(r => r.name), [`${job.id}-1`])
		assert.match(detail.body.runs[0]?.text ?? '', /Review MR/)
		assert.equal((await hh.api<ApiError>('GET', '/learning/jobs/j-nope')).status, 404)
		assert.equal((await hh.api<ApiError>('POST', '/learning/jobs/j-nope/cancel', {})).status, 404)

		// события кейса: якорь «открыть место в сессии»
		const all = (await hh.api<RawEvent[]>('GET', `/learning/cases/${c1}/raw`)).body
		assert.ok(all.length >= 1)
		const one = (await hh.api<RawEvent[]>('GET', `/learning/cases/${c1}/raw?from=1&to=1`)).body
		assert.deepEqual(one.map(e => e.n), [1])
		assert.equal((await hh.api<ApiError>('GET', `/learning/cases/${c1}/raw?from=x`)).status, 400)
		assert.equal((await hh.api<ApiError>('GET', '/learning/cases/c-nope/raw')).status, 404)

		// правка описания руками
		const sha = (t: string): string => createHash('sha1').update(t).digest('hex')
		const detail1 = (await hh.api<CaseDetail>('GET', `/learning/cases/${c1}`)).body
		assert.equal(detail1.summaryHash, sha(detail1.summary))
		const stale = await hh.api<ApiError>('PUT', `/learning/cases/${c1}/summary`, { text: '# X', base: sha('чужое') })
		assert.deepEqual([stale.status, stale.body.code], [409, 'stale'])
		assert.equal((await hh.api<ApiError>('PUT', `/learning/cases/${c1}/summary`, { text: '# X' })).status, 400)
		assert.equal((await hh.api('PUT', `/learning/cases/${c1}/summary`, { text: '# Edited by hand\n## Goal: do it (type: fix)', base: detail1.summaryHash })).status, 200)
		assert.equal(fs.readFileSync(path.join(hh.home, 'cases', c1, 'summary.md'), 'utf8'), '# Edited by hand\n## Goal: do it (type: fix)')
		const detail2 = (await hh.api<CaseDetail>('GET', `/learning/cases/${c1}`)).body
		// название кейса — название сессии: правка описания его не меняет
		assert.deepEqual([detail2.title, detail2.goals], [detail1.title, [{ title: 'do it', type: 'fix' }]])
		assert.equal((await hh.api<ApiError>('PUT', '/learning/cases/c-nope/summary', { text: 'x', base: sha('') })).status, 404)

		// плейбук с правилом, у которого два кейса-доказательства
		const evidence = [c1, c2].map(caseId => ({ caseId, anchor: 'n 1' }))
		const pb = learning.playbooks.create({ ...DRAFT, rules: [{ text: 'Run lint before review', stage: 1, evidence }] }, { task: 'review', taskType: 'review-mr', playbookId: null, cases: evidence }, null)
		const impact = await hh.api<CaseImpact>('GET', `/learning/cases/${c1}/impact`)
		assert.equal(impact.status, 200)
		assert.deepEqual(impact.body.rules.map(r => [r.playbookId, r.text, r.evidenceLeft]), [[pb.id, 'Run lint before review', 1]])
		assert.equal((await hh.api<ApiError>('GET', '/learning/cases/c-nope/impact')).status, 404)

		// PATCH: lint, успех (удалён шаг, новое правило), 404
		const bad = await hh.api<ApiError>('PATCH', `/learning/playbooks/${pb.id}`, { baseVersion: pb.version, description: 'Reviews merge requests' })
		assert.equal(bad.status, 400)
		assert.equal(bad.body.code, 'lint')
		assert.match(bad.body.error, /Use when/)
		assert.equal((await hh.api<ApiError>('PATCH', `/learning/playbooks/${pb.id}`, { baseVersion: pb.version })).status, 400)
		assert.equal((await hh.api<ApiError>('PATCH', `/learning/playbooks/${pb.id}`, { title: 'x' })).status, 400)
		const oldVer = await hh.api<ApiError>('PATCH', `/learning/playbooks/${pb.id}`, { baseVersion: pb.version + 5, title: 'x' })
		assert.deepEqual([oldVer.status, oldVer.body.code, oldVer.body.version], [409, 'stale', pb.version])
		const patched = await hh.api<PlaybookView>('PATCH', `/learning/playbooks/${pb.id}`, {
			baseVersion: pb.version,
			stages: [{ ...DRAFT.stages[0], slug: 'post', title: 'Post comments' }],
			rules: [{ text: 'Check tests first', stage: 1 }],
			removeRules: pb.rules.map(r => r.id),
		})
		assert.equal(patched.status, 200)
		assert.equal(patched.body.version, pb.version + 1)
		assert.deepEqual(patched.body.stages.map(s => [s.n, s.slug]), [[1, 'post']])
		assert.deepEqual(patched.body.rules.map(r => r.status).sort(), ['archived', 'candidate'])
		const files = fs.readdirSync(path.join(hh.home, 'playbooks', pb.id, 'files', 'stages'))
		assert.deepEqual(files, ['01-post.md'])
		const journal = (await hh.api<JournalEntry[]>('GET', '/learning/journal')).body
		assert.equal(journal.at(-1)?.kind, 'edit')
		assert.equal((await hh.api<ApiError>('PATCH', '/learning/playbooks/p-nope', { baseVersion: 1, title: 'x' })).status, 404)

		// остановка сборщика: заданий нет — не ошибка, кейс остаётся
		assert.equal((await hh.api('POST', `/learning/cases/${c2}/collector/stop`, {})).status, 200)
		assert.equal(learning.getCase(c2).status, 'ready')
		assert.equal((await hh.api<ApiError>('POST', '/learning/cases/c-nope/collector/stop', {})).status, 404)
	})

	it('изменения плейбуков без токена оператора — 403, чтение открыто', T, async () => {
		const TOKEN = 'operator-token-0123456789abcdef0123456789'
		h = await startHarness({ base, config: { authToken: TOKEN, authRequired: true } })
		assert.equal((await h.api('GET', '/learning/playbooks')).status, 200)
		const writes: Array<[string, string]> = [
			['POST', '/learning/playbooks/p-x/review'],
			['POST', '/learning/playbooks/p-x/approve'],
			['POST', '/learning/playbooks/p-x/reject'],
			['POST', '/learning/playbooks/p-x/status'],
			['POST', '/learning/playbooks/p-x/revert'],
			['POST', '/learning/playbooks/p-x/edits/h1/accept'],
			['POST', '/learning/playbooks/p-x/edits/h1/reject'],
			['DELETE', '/learning/playbooks/p-x'],
			['PUT', '/learning/playbooks/p-x/notes'],
			['PUT', '/learning/cases/c-x/notes'],
			['PUT', '/learning/cases/c-x/summary'],
			['POST', '/learning/cases/c-x/collector/stop'],
			['PATCH', '/learning/playbooks/p-x'],
			['POST', '/learning/jobs/j-x/cancel'],
			['POST', '/learning/journal/jr-x/revert'],
			['POST', '/learning/chat/p-x'],
		]
		for (const [method, p] of writes) {
			const r: { status: number; body: ApiError } = await h.api<ApiError>(method, p, method === 'DELETE' ? undefined : {})
			assert.equal(r.status, 403, `${method} ${p}`)
			assert.equal(r.body.code, 'operator_required')
		}
		assert.equal((await h.api<ApiError>('GET', '/learning/playbooks/p-x')).status, 404)
	})
})
