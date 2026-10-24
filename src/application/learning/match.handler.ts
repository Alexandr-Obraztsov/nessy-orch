import { caseCard, playbookCard } from '../../domain/cards'
import { goalsOf } from '../../domain/brief'
import { fillPrompt, parseMatch } from '../../domain/learning-replies'
import { buildIndex, search } from '../../domain/learning-search'
import type { GroupMember, MatchDecision } from '../../domain/playbook.types'
import type { CaseState, PlaybookState } from './learning.types'
import type { JobContext, JobHandler } from './handlers.types'
import { groupHash, sameSet } from './build.handler'

/** Сколько ближайших кейсов BM25 добавляет к каждому новому. */
const NEIGHBOURS = 10
/** Сколько новых кейсов за один вызов сопоставителя. */
const CHUNK = 10
/** Минимум кейсов в группе для новой сборки плейбука. */
export const MIN_BUILD = 3
/** Обзор прочих кейсов не длиннее (знаков); сверх — отсеиваются самые давние. */
export const OVERVIEW_CHARS = 400_000
/** Но не меньше стольких кейсов остаётся в обзоре. */
export const OVERVIEW_MIN_CASES = 300
/** Столько после провала сборки та же группа заново не собирается. */
const FAILED_BUILD_MS = 24 * 3600 * 1000

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const members = (p: PlaybookState): string[] => [...p.cases, ...(p.heldOut ? [p.heldOut] : [])]

const norm = (s: string): string => s.trim().toLowerCase()

/** Карточка кейса: `CASE <id>` и текст карточки. */
function cardOf(ctx: JobContext, c: CaseState): string {
	return `CASE ${c.id}\n${caseCard({ title: ctx.cases.sessionTitle(c.id), date: c.closedAt ?? c.updatedAt, summary: ctx.cases.summary(c.id) })}`
}

/** Обзор прочих кейсов: свежие первыми; пока суммарно > `OVERVIEW_CHARS`, самые давние выбрасываются (но не меньше `OVERVIEW_MIN_CASES`). */
export function overviewCards(cards: ReadonlyArray<{ id: string; text: string }>): string[] {
	const kept = [...cards]
	let total = kept.reduce((n, c) => n + c.text.length + 2, 0)
	while (total > OVERVIEW_CHARS && kept.length > OVERVIEW_MIN_CASES) {
		const last = kept.pop()
		total -= (last?.text.length ?? 0) + 2
	}
	return kept.map(c => c.text)
}

/** Сколько знаков занимает состав группы в журнале и дедупликации. */
export function memberKey(ms: readonly GroupMember[]): string {
	return groupHash(ms.map(m => `${m.caseId}#${norm(m.goal)}`))
}

/** Члены группы, которые существуют: кейс `ready` и цель с таким названием в его описании (название приводится к названию из описания). */
export function validMembers(ctx: JobContext, ms: readonly GroupMember[]): GroupMember[] {
	const out: GroupMember[] = []
	for (const m of ms) {
		const c = ctx.cases.get(m.caseId)
		if (!c || c.status !== 'ready') continue
		const goal = goalsOf(ctx.cases.summary(m.caseId)).find(g => norm(g.title) === norm(m.goal))
		if (!goal) continue
		if (!out.some(x => x.caseId === m.caseId && x.goal === goal.title)) out.push({ ...m, goal: goal.title })
	}
	return out
}

/** Сборка этой группы недавно провалилась окончательно: ≥ 2/3 кейсов общие с провалившейся. */
export function failedRecently(ctx: JobContext, ids: readonly string[]): boolean {
	return (ctx.failedBuilds?.() ?? []).some(f => ctx.now() - f.at < FAILED_BUILD_MS && ids.filter(id => f.cases.includes(id)).length * 3 >= ids.length * 2)
}

/** Ближайшие по BM25 к новым кейсам (round-robin, чтобы бюджет делился поровну): id и название. */
function hints(ctx: JobContext, others: ReadonlyArray<{ c: CaseState; text: string }>, fresh: ReadonlyArray<{ c: CaseState; text: string }>): string {
	if (!others.length) return '(none)'
	const index = buildIndex(others.map(o => ({ id: o.c.id, text: o.text })))
	const lists = fresh.map(f => search(index, f.text, NEIGHBOURS).map(h => h.id))
	const picked: string[] = []
	for (let i = 0; i < NEIGHBOURS; i++) for (const l of lists) if (l[i] !== undefined && !picked.includes(l[i] as string)) picked.push(l[i] as string)
	return picked.length ? picked.map(id => `${id} | ${ctx.cases.sessionTitle(id)}`).join('\n') : '(none)'
}

/**
 * Сопоставитель: один агент видит обзор целиком (карточки всех плейбуков и прочих кейсов) и новые кейсы, углубляется командами
 * `case show` / `playbook show`. Каждая найденная группа ставится на проверку вторым проходом (`verify`).
 */
export const matchHandler: JobHandler = {
	kinds: ['match'],
	async run(ctx) {
		const playbooks = ctx.playbooks
		if (!playbooks) {
			ctx.finish('нет хранилища плейбуков')
			return
		}
		const ready = ctx.cases.all().filter(c => c.status === 'ready')
		const fresh = strings(ctx.job.payload?.['caseIds'])
			.map(id => ready.find(c => c.id === id))
			.filter((c): c is CaseState => c !== undefined)
		if (!fresh.length) {
			ctx.finish('нет новых готовых кейсов')
			return
		}
		if (!playbooks.list().length && ready.length < 2) {
			ctx.finish('сопоставлять не с чем')
			return
		}
		const text = new Map(ready.map(c => [c.id, cardOf(ctx, c)]))
		const byFresh = (a: CaseState, b: CaseState): number => (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt)
		for (let at = 0; at < fresh.length; at += CHUNK) {
			const chunk = fresh.slice(at, at + CHUNK)
			const ids = new Set(chunk.map(c => c.id))
			const others = ready.filter(c => !ids.has(c.id)).sort(byFresh)
			const all = playbooks.list()
			if (!others.length && !all.length && chunk.length < 2) continue
			const overview = overviewCards(others.map(c => ({ id: c.id, text: text.get(c.id) ?? '' })))
			const prompt = fillPrompt(ctx.prompt('matcher'), {
				new_case: chunk.map(c => text.get(c.id) ?? '').join('\n\n'),
				playbooks: all.length ? all.map(p => `PLAYBOOK ${p.id}\n${playbookCard(p)}`).join('\n\n') : '(none)',
				other_cases: overview.length ? overview.join('\n\n') : '(none)',
				hints: hints(
					ctx,
					others.map(c => ({ c, text: text.get(c.id) ?? '' })),
					chunk.map(c => ({ c, text: text.get(c.id) ?? '' })),
				),
			})
			const res = await ctx.runAgent('matcher', `Сопоставление сессий: ${chunk.length}`, prompt)
			const groups = parseMatch(res.text)
			if (!groups) throw new Error('в ответе нет <result> со списком групп')
			queueVerify(ctx, ids, groups)
		}
		ctx.finish()
	},
}

/** Группы ответа, достойные проверки, ставятся заданием `verify` (по одному на группу). */
function queueVerify(ctx: JobContext, freshIds: ReadonlySet<string>, groups: readonly MatchDecision[]): void {
	const playbooks = ctx.playbooks
	if (!playbooks) return
	for (const g of groups) {
		const ms = validMembers(ctx, g.members)
		// группа должна задевать новую сессию
		if (!ms.some(m => freshIds.has(m.caseId))) continue
		const ids = [...new Set(ms.map(m => m.caseId))].sort()
		const known = g.playbookId === null ? null : playbooks.get(g.playbookId)
		if (g.action === 'new_playbook') {
			if (ids.length < MIN_BUILD) continue
			if (playbooks.list().some(p => sameSet(members(p), ids))) continue
			if (failedRecently(ctx, ids)) continue
		} else {
			if (!known) continue
			// кейсы, которые уже в плейбуке, повторно не вливаются
			if (!ms.some(m => !known.cases.includes(m.caseId) && known.heldOut !== m.caseId)) continue
		}
		ctx.log('info', ids[0] ?? '', `Сопоставление: найдена группа «${g.task}» (${g.action}), членов ${ms.length}, на проверку`)
		ctx.enqueue('verify', `verify:${memberKey(ms)}`, { payload: { ...g, members: ms } })
	}
}
