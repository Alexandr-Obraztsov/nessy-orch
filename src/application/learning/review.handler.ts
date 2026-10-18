import { AppError } from '../../domain/errors'
import type { ReviewReport, StageReport } from '../../../shared/types'
import { renderPortion } from '../../domain/case-events'
import { fillPrompt, parseComparison, parseConsistency, parseDescription, parseGrade, parsePlan, parseReview, parseSelection } from '../../domain/learning-replies'
import { similarity } from '../../domain/learning-search'
import { mergeRanges, parseAnchor } from '../../domain/anchors'
import { lintPlaybook, validDescription } from '../../domain/playbook-lint'
import { renderPlaybook } from '../../domain/playbook-render'
import type { Range } from '../../domain/playbook.types'
import { countCorrections } from '../../domain/rule-counters'
import type { JobContext, JobHandler } from './handlers.types'
import type { PlaybookState } from './learning.types'
import { untilRemoved } from './playbook-edits'
import type { PlaybookService } from './playbook.service'
import type { ReviewEdits, ReviewSink } from './review.types'

/** Отступ вокруг якоря при выборке доказательств, событий. */
const PAD = 3
/** Знаков доказательств на один кейс. */
const CASE_CHARS = 40_000
/** Знаков одного сообщения пользователя в заданиях ступеней 5 и 6. */
const MESSAGE_CHARS = 2000
/** Прогонов отложенного кейса (ступень 5). */
const RUNS = 3
/** Кейсов других типов (ступень 6). */
const OTHER_CASES = 5
/** Порог сходства описаний и правил (ступень 4). */
const DUPLICATE = 0.6

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text)

const hasSink = (ps: PlaybookService): ps is PlaybookService & ReviewSink => 'saveReview' in ps && typeof ps.saveReview === 'function'

/** Правки на ревью из `payload` задания; нет — это ревью целого плейбука. */
function editsOf(payload: Record<string, unknown> | null): ReviewEdits | null {
	const hashes = payload?.['edits']
	if (!Array.isArray(hashes)) return null
	const base = payload?.['baseVersion']
	return { hashes: hashes.map(String), baseVersion: typeof base === 'number' ? base : 0 }
}

/** Файлы плейбука одним текстом: `### FILE: <путь>` и содержимое (без CHANGELOG). */
function playbookText(ps: PlaybookService, p: PlaybookState): string {
	const files = renderPlaybook(p, ps.notes(p.id), '')
	return Object.keys(files)
		.filter(f => f !== 'CHANGELOG.md')
		.sort()
		.map(f => `### FILE: ${f}\n${files[f] ?? ''}`)
		.join('\n\n')
}

/** Среднее число поправок на кейс по описаниям кейсов плейбука (нет кейсов — 0). */
export function meanCorrections(caseIds: readonly string[], summaryOf: (id: string) => string): number {
	if (!caseIds.length) return 0
	return caseIds.reduce((a, id) => a + countCorrections(summaryOf(id)), 0) / caseIds.length
}

/** Якоря правил плейбука по кейсам. */
function anchorsByCase(p: PlaybookState): Map<string, Range[]> {
	const out = new Map<string, Range[]>()
	for (const r of p.rules) {
		for (const e of r.evidence) {
			const range = parseAnchor(e.anchor)
			if (!range) continue
			out.set(e.caseId, [...(out.get(e.caseId) ?? []), range])
		}
	}
	return out
}

/** Доказательства по кейсам: raw вокруг якорей правил; с `withSummary` — ещё описание кейса. */
function evidenceText(ctx: JobContext, p: PlaybookState, withSummary: boolean): string {
	const anchors = anchorsByCase(p)
	const ids = [...new Set([...p.cases, ...anchors.keys()])].filter(id => id !== p.heldOut)
	const blocks: string[] = []
	for (const id of ids) {
		const parts: string[] = [`CASE: ${id}`]
		if (withSummary) parts.push(`Description:\n${ctx.cases.summary(id)}`)
		let left = CASE_CHARS
		const chunks: string[] = []
		for (const r of mergeRanges(anchors.get(id) ?? [], PAD)) {
			if (left <= 0) break
			const text = renderPortion(ctx.cases.raw(id, r.from, r.to), left).text
			if (!text) continue
			chunks.push(text)
			left -= text.length
		}
		parts.push(chunks.length ? `Events:\n${chunks.join('\n...\n')}` : 'Events: (no anchored events)')
		blocks.push(parts.join('\n'))
	}
	return blocks.length ? blocks.join('\n\n') : '(no evidence)'
}

/** Минимальный `n` из якорей Actions первой цели описания; нет якорей — null. */
function firstGoalMin(summary: string): number | null {
	const goal = /^##\s+Goal:/m.exec(summary)
	if (!goal) return null
	const rest = summary.slice(goal.index + goal[0].length)
	const next = /^##\s+Goal:/m.exec(rest)
	const body = next ? rest.slice(0, next.index) : rest
	const actions = /^###\s+Actions\s*$/im.exec(body)
	if (!actions) return null
	const tail = body.slice(actions.index + actions[0].length)
	const end = /^###\s/m.exec(tail)
	const section = end ? tail.slice(0, end.index) : tail
	const ns = [...section.matchAll(/\bn\s*(\d+)/g)].map(m => Number(m[1]))
	return ns.length ? Math.min(...ns) : null
}

/** Первые сообщения пользователя по якорю первой цели кейса (задача планировщика); нет сообщений — null. */
function taskMessages(ctx: JobContext, caseId: string): string | null {
	const users = ctx.cases.raw(caseId, 1).filter(e => e.kind === 'user')
	const min = firstGoalMin(ctx.cases.summary(caseId))
	const near = min === null ? [] : users.filter(e => e.n <= min + 5).slice(0, 3)
	const picked = near.length ? near : users.slice(0, 3)
	if (!picked.length) return null
	return picked.map(e => `[${e.n}] ${clip(e.text, MESSAGE_CHARS)}`).join('\n\n')
}

/** Первое сообщение пользователя в кейсе. */
function firstMessage(ctx: JobContext, caseId: string): string | null {
	const e = ctx.cases.raw(caseId, 1).find(x => x.kind === 'user')
	return e ? clip(e.text, MESSAGE_CHARS) : null
}

const stageReport = (stage: StageReport['stage'], verdict: StageReport['verdict'], critical: string[], notes: string[], agentIds: string[]): StageReport => ({ stage, verdict, critical, notes, agentIds })

/** Один вызов агента: подставляет ровно переданные значения и запоминает id агента. */
async function ask(ctx: JobContext, ids: string[], name: string, title: string, prompt: string, vars: Record<string, string>): Promise<string> {
	const res = await ctx.runAgent(name, title, fillPrompt(ctx.prompt(prompt), vars))
	ids.push(res.agentId)
	return res.text
}

function unparsed(stage: string): Error {
	return new Error(`ревью, ступень ${stage}: в ответе нет разбираемого <result>`)
}

/** Ступени 2–4: оценка текста агентом по доказательствам. */
async function gradeStage(ctx: JobContext, ps: PlaybookService, p: PlaybookState, stage: 2 | 3 | 4): Promise<StageReport> {
	const ids: string[] = []
	const playbook = playbookText(ps, p)
	const name = `review-${p.id}-${stage}`
	let grade: { critical: string[]; notes: string[] } | null
	if (stage === 2) {
		grade = parseGrade(await ask(ctx, ids, name, `Ревью ${p.id}: доказательства`, 'grader', { playbook, evidence: evidenceText(ctx, p, false) }))
	} else if (stage === 3) {
		grade = parseReview(await ask(ctx, ids, name, `Ревью ${p.id}: два вердикта`, 'reviewer', { playbook, cases: evidenceText(ctx, p, true) }))
	} else {
		const others = ps.list().filter(o => o.id !== p.id && (o.status === 'active' || o.status === 'trial'))
		const othersText = others.length
			? others.map(o => `### PLAYBOOK: ${o.id}\nDescription: ${o.description}\nRules:\n${o.rules.filter(r => r.status !== 'archived').map(r => `- ${r.text}`).join('\n') || '- (none)'}`).join('\n\n')
			: '(no other playbooks)'
		const noteBlocks = [p, ...others].map(o => ({ id: o.id, text: ps.notes(o.id).trim() })).filter(n => n.text)
		const notes = noteBlocks.length ? noteBlocks.map(n => `### NOTES: ${n.id}\n${n.text}`).join('\n\n') : '(no user notes)'
		const dup: string[] = []
		for (const o of others) {
			const d = similarity(p.description, o.description)
			if (d >= DUPLICATE) dup.push(`description of ${p.id} ~ description of ${o.id} (${d.toFixed(2)})`)
			for (const r of p.rules) {
				for (const x of o.rules) {
					const s = similarity(r.text, x.text)
					if (s >= DUPLICATE) dup.push(`rule "${r.text}" ~ rule "${x.text}" of ${o.id} (${s.toFixed(2)})`)
				}
			}
		}
		grade = parseConsistency(await ask(ctx, ids, name, `Ревью ${p.id}: согласованность`, 'consistency', { playbook, others: othersText, notes, duplicates: dup.length ? dup.join('\n') : '(none)' }))
	}
	if (!grade) throw unparsed(String(stage))
	return stageReport(stage, grade.critical.length ? 'fail' : 'pass', grade.critical, grade.notes, ids)
}

/** Ступень 5: план отложенного кейса с плейбуком и без, слепое сравнение; ≥ 2 из 3 не хуже — pass. */
async function heldOutStage(ctx: JobContext, ps: PlaybookService, p: PlaybookState): Promise<StageReport> {
	if (!p.heldOut) return stageReport(5, 'skip', [], ['no held-out case'], [])
	const task = ctx.cases.get(p.heldOut) ? taskMessages(ctx, p.heldOut) : null
	if (task === null) return stageReport(5, 'skip', [], [`held-out case ${p.heldOut} has no user messages`], [])
	const accepted = ctx.cases.summary(p.heldOut)
	const playbook = playbookText(ps, p)
	const ids: string[] = []
	const outcomes = await Promise.all(
		Array.from({ length: RUNS }, async (_, i) => {
			const name = `review-${p.id}-5-${i + 1}`
			const [withPlan, withoutPlan] = await Promise.all([
				ask(ctx, ids, `${name}-with`, `Ревью ${p.id}: план с плейбуком`, 'planner', { task, playbook }),
				ask(ctx, ids, `${name}-without`, `Ревью ${p.id}: план без плейбука`, 'planner', { task, playbook: '(none)' }),
			])
			const a = parsePlan(withPlan)
			const b = parsePlan(withoutPlan)
			if (!a || !b) throw unparsed('5 (планировщик)')
			// сторона плана с плейбуком зависит от времени и номера прогона: без постоянного перекоса, но детерминированно
			const swap = (Math.floor(ctx.now() / 1000) + i) % 2 === 1
			const [planA, planB] = swap ? [b.plan, a.plan] : [a.plan, b.plan]
			const cmp = parseComparison(await ask(ctx, ids, `${name}-cmp`, `Ревью ${p.id}: слепое сравнение`, 'comparator', { task, accepted, plan_a: planA, plan_b: planB }))
			if (!cmp) throw unparsed('5 (сравнение)')
			const verdict: 'with' | 'without' | 'tie' = cmp.winner === 'tie' ? 'tie' : (cmp.winner === 'A') !== swap ? 'with' : 'without'
			return { verdict, reason: cmp.reason }
		}),
	)
	const good = outcomes.filter(o => o.verdict !== 'without').length
	const notes = outcomes.map((o, i) => `run ${i + 1}: ${o.verdict}. ${o.reason}`)
	const pass = good >= 2
	return stageReport(5, pass ? 'pass' : 'fail', pass ? [] : [`plan with the playbook was not worse than without in ${good} of ${RUNS} runs (need 2)`], notes, ids)
}

interface SelectionResult {
	hits: number
	own: number
	falseHits: number
	misses: string[]
	agentIds: string[]
}

/** Ступень 6, один проход: селектор выбирает плейбук по каждому сообщению. */
async function selectionPass(ctx: JobContext, ps: PlaybookService, p: PlaybookState, description: string, own: string[], other: string[]): Promise<SelectionResult> {
	const ids: string[] = []
	const listed = [...ps.list().filter(o => o.id !== p.id && (o.status === 'active' || o.status === 'trial')), { ...p, description }]
	const playbooks = listed.map(o => `- id: ${o.id}\n  type: ${o.taskType}\n  description: ${o.description}`).join('\n')
	const choose = async (message: string, k: string): Promise<string | null> => {
		const sel = parseSelection(await ask(ctx, ids, `review-${p.id}-6-${k}`, `Ревью ${p.id}: выбор по описанию`, 'selector', { playbooks, message }))
		if (!sel) throw unparsed('6')
		return sel.playbookId
	}
	const ownPicks = await Promise.all(own.map((m, i) => choose(m, `own${i + 1}`)))
	const otherPicks = await Promise.all(other.map((m, i) => choose(m, `other${i + 1}`)))
	const misses = [
		...own.filter((_, i) => ownPicks[i] !== p.id).map(m => `FAILED TO TRIGGER: "${clip(m, 300)}"`),
		...other.filter((_, i) => otherPicks[i] === p.id).map(m => `FALSE TRIGGER: "${clip(m, 300)}"`),
	]
	return { hits: ownPicks.filter(x => x === p.id).length, own: own.length, falseHits: otherPicks.filter(x => x === p.id).length, misses, agentIds: ids }
}

const selectionOk = (r: SelectionResult): boolean => r.hits * 3 >= r.own * 2 && r.falseHits <= 1
const scoreLine = (r: SelectionResult): string => `own ${r.hits}/${r.own}, false ${r.falseHits}`

/** Ступень 6: выбор плейбука по описанию; провал — один раз `description-improver` и повтор; снова провал — только заметка. */
async function descriptionStage(ctx: JobContext, ps: PlaybookService, p: PlaybookState): Promise<StageReport> {
	const own = [...new Set([...p.cases, ...(p.heldOut ? [p.heldOut] : [])])].map(id => firstMessage(ctx, id)).filter((m): m is string => m !== null)
	const otherCases = ctx.cases
		.all()
		.filter(c => c.status === 'ready' && c.goals.length > 0 && !c.goals.some(g => g.type === p.taskType) && !p.cases.includes(c.id) && c.id !== p.heldOut)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
	const other: string[] = []
	for (const c of otherCases) {
		if (other.length >= OTHER_CASES) break
		const m = firstMessage(ctx, c.id)
		if (m !== null) other.push(m)
	}
	if (!own.length) return stageReport(6, 'skip', [], ['no user messages in the cases of the group'], [])
	const first = await selectionPass(ctx, ps, p, p.description, own, other)
	const ids = [...first.agentIds]
	const notes = [`description "${clip(p.description, 120)}": ${scoreLine(first)}`]
	if (selectionOk(first)) return stageReport(6, 'pass', [], notes, ids)

	const history = `- "${p.description}" (${scoreLine(first)})`
	const improved = parseDescription(await ask(ctx, ids, `review-${p.id}-6-improve`, `Ревью ${p.id}: улучшение описания`, 'description-improver', { playbook: playbookText(ps, p), misses: first.misses.join('\n') || '(none)', history }))
	const bad = improved ? validDescription(improved.description) : 'no result'
	if (!improved || bad !== null) {
		notes.push(`description improver gave no usable description (${bad}); description left as is`)
		return stageReport(6, 'fail', [], notes, ids)
	}
	const second = await selectionPass(ctx, ps, p, improved.description, own, other)
	ids.push(...second.agentIds)
	notes.push(`new description "${clip(improved.description, 120)}": ${scoreLine(second)}`)
	if (!selectionOk(second)) {
		notes.push('the description still misses; kept the original (soft threshold, not critical)')
		return stageReport(6, 'fail', [], notes, ids)
	}
	ps.saveVersion({ ...ps.need(p.id), description: improved.description }, 'Improved description after the selector check', {
		kind: 'version',
		subject: p.id,
		summary: `${p.id}: описание улучшено ревью (${scoreLine(first)} → ${scoreLine(second)})`,
		report: null,
		revertible: true,
		revertedBy: null,
	})
	notes.push('description replaced')
	return stageReport(6, 'pass', [], notes, ids)
}

function lintStage(ctx: JobContext, ps: PlaybookService, p: PlaybookState): StageReport {
	const known = new Set(ctx.cases.all().map(c => c.id))
	// у нового плейбука доказательства строгие, у уже работающего — только заметки
	const issues = lintPlaybook(p, renderPlaybook(p, ps.notes(p.id), ''), known, { strictEvidence: p.status === 'draft' || p.status === 'review' })
	const critical = issues.filter(i => i.level === 'critical').map(i => `${i.where}: ${i.text}`)
	const notes = issues.filter(i => i.level === 'note').map(i => `${i.where}: ${i.text}`)
	return stageReport(1, critical.length ? 'fail' : 'pass', critical, notes, [])
}

/** Ступени по порядку; критичное на 1–4 останавливает следующие (они записываются как `skip`). */
async function runStages(ctx: JobContext, ps: PlaybookService, id: string): Promise<StageReport[]> {
	const stages: StageReport[] = []
	const stopped = (): boolean => stages.some(s => s.verdict === 'fail' && s.stage <= 4)
	const steps: Array<[StageReport['stage'], () => Promise<StageReport> | StageReport]> = [
		[1, () => lintStage(ctx, ps, ps.need(id))],
		[2, () => gradeStage(ctx, ps, ps.need(id), 2)],
		[3, () => gradeStage(ctx, ps, ps.need(id), 3)],
		[4, () => gradeStage(ctx, ps, ps.need(id), 4)],
		[5, () => heldOutStage(ctx, ps, ps.need(id))],
		[6, () => descriptionStage(ctx, ps, ps.need(id))],
	]
	for (const [n, run] of steps) {
		stages.push(stopped() ? stageReport(n, 'skip', [], ['not run: an earlier stage found critical problems'], []) : await run())
	}
	return stages
}

const journalReport = (prevStatus: string, report: ReviewReport): string => JSON.stringify({ prevStatus, review: report })

/** Отчёт — в хранилище (если у сервиса есть `saveReview`); копия всегда лежит в `report` записи журнала. */
function saveReport(ps: PlaybookService, report: ReviewReport): void {
	if (hasSink(ps)) ps.saveReview(report)
}

/**
 * Откат правок улучшателя: содержание возвращается к версии до правок (`baseVersion` из задания, без него — к предыдущей),
 * рабочие поля (статус, счётчики, кейсы) остаются текущими; хэши правок идут в `rejectedEdits`.
 */
export function rejectEdits(ps: PlaybookService, id: string, hashes: readonly string[], reason: string, baseVersion = 0): PlaybookState {
	const cur = ps.need(id)
	const base = baseVersion > 0 ? baseVersion : cur.version - 1
	if (base >= 1 && base < cur.version) ps.revertToVersion(id, base)
	const after = ps.need(id)
	const merged = [...new Set([...after.rejectedEdits, ...hashes])]
	return ps.saveVersion({ ...after, rejectedEdits: merged }, `Rejected edits: ${reason}`)
}

/** Одобрить и отклонить можно только плейбук, который ждёт решения: `draft`/`review`. */
function assertAwaitingHuman(p: PlaybookState): void {
	if (p.status !== 'draft' && p.status !== 'review') throw new AppError(409, 'bad_status', `плейбук ${p.id} в статусе ${p.status}: решать нечего`)
}

/** Ручное одобрение (`review` → `trial`); `before` — среднее число поправок до плейбука (см. `meanCorrections`). */
export function approvePlaybook(ps: PlaybookService, id: string, before = 0): PlaybookState {
	const p = ps.need(id)
	assertAwaitingHuman(p)
	const saved = ps.saveVersion({ ...p, status: 'trial', trial: { before, cases: [], corrections: [] } }, 'Approved by the user')
	ps.record({ kind: 'review_passed', subject: id, summary: `${id}: ${p.status} → trial. Одобрен пользователем`, report: JSON.stringify({ prevStatus: p.status }), revertible: true, revertedBy: null })
	return saved
}

/** Ручной отказ: плейбук выключается (`disabled`) с причиной в журнале. */
export function rejectPlaybook(ps: PlaybookService, id: string, reason: string): PlaybookState {
	assertAwaitingHuman(ps.need(id))
	return ps.setStatus(id, 'disabled', `Rejected by the user. ${reason}`, 'review_failed')
}

/** Авто-ревью в шесть ступеней; результат — `trial` либо `review` (ждёт человека). Новых заданий не ставит. */
export const reviewHandler: JobHandler = {
	kinds: ['review'],
	run: ctx => untilRemoved(ctx, () => reviewJob(ctx)),
}

async function reviewJob(ctx: JobContext): Promise<void> {
	const ps = ctx.playbooks
	if (!ps) {
		ctx.finish('нет хранилища плейбуков')
		return
	}
	const id = ctx.job.subject
	const start = ps.get(id)
	if (!start) {
		ctx.finish('плейбук удалён')
		return
	}
	const edits = editsOf(ctx.job.payload)
	if (!edits && start.status !== 'draft' && start.status !== 'review') {
		ctx.finish(`статус ${start.status}: ревью не нужно`)
		return
	}
	if (!ctx.settings().autoReview) {
		// правки живого плейбука остаются как есть: статус `review` снял бы его с публикации
		if (!edits) ps.setStatus(id, 'review', 'Auto-review is off: waiting for the user')
		ctx.finish('авто-ревью выключено: ждёт человека')
		return
	}

	const stages = await runStages(ctx, ps, id)
	const passed = stages.every(s => s.stage === 6 || s.verdict !== 'fail')
	const p = ps.need(id)
	// пока шло ревью, пользователь мог сам включить, выключить или заархивировать плейбук: его решение не трогаем
	if (!edits && p.status !== start.status) {
		ctx.finish('статус изменён пользователем')
		return
	}
	const reason = stages.flatMap(s => s.critical).slice(0, 3).join('; ')

	if (edits) {
		const mk = (version: number): ReviewReport => ({ playbookId: id, version, ts: new Date(ctx.now()).toISOString(), passed, stages })
		if (passed) {
			const report = mk(p.version)
			saveReport(ps, report)
			ps.record({ kind: 'review_passed', subject: id, summary: `${id}: правки (${edits.hashes.length}) прошли ревью`, report: journalReport(p.status, report), revertible: false, revertedBy: null })
		} else {
			const rejected = rejectEdits(ps, id, edits.hashes, reason, edits.baseVersion)
			const report = mk(rejected.version)
			saveReport(ps, report)
			ps.record({ kind: 'review_failed', subject: id, summary: `${id}: правки (${edits.hashes.length}) отклонены ревью. ${reason}`, report: journalReport(p.status, report), revertible: false, revertedBy: null })
		}
		ctx.finish(passed ? 'правки прошли ревью' : 'правки отклонены, версия откачена')
		return
	}

	const next = passed
		? { ...p, status: 'trial' as const, trial: { before: meanCorrections(p.cases, c => ctx.cases.summary(c)), cases: [], corrections: [] } }
		: { ...p, status: 'review' as const, reviewAttempts: p.reviewAttempts + 1 }
	const saved = ps.saveVersion(next, passed ? 'Auto-review passed: trial' : 'Auto-review failed: waiting for the user')
	const report: ReviewReport = { playbookId: id, version: saved.version, ts: new Date(ctx.now()).toISOString(), passed, stages }
	saveReport(ps, report)
	ps.record({
		kind: passed ? 'review_passed' : 'review_failed',
		subject: id,
		summary: passed ? `${id}: ${p.status} → trial. Ревью пройдено` : `${id}: ${p.status} → review. Ревью не пройдено: ${reason || 'см. отчёт'}`,
		report: journalReport(p.status, report),
		revertible: true,
		revertedBy: null,
	})
	ctx.finish(passed ? 'ревью пройдено: trial' : 'ревью не пройдено: ждёт человека')
}
