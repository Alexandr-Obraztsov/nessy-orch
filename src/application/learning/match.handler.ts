import type { Evidence } from '../../../shared/types'
import { buildIndex, caseDigest, search } from '../../domain/learning-search'
import { fillPrompt, parseMatch } from '../../domain/learning-replies'
import { PORTION_CHARS } from '../../domain/learning-settings'
import type { MatchGroup } from '../../domain/playbook.types'
import type { CaseState, PlaybookState } from './learning.types'
import type { JobContext, JobHandler } from './handlers.types'
import { groupHash, sameSet } from './build.handler'

/** Сколько ближайших кейсов поиск добавляет к каждому новому. */
const NEIGHBOURS = 10
/** Сколько новых кейсов за один вызов сопоставителя: больше — несколько вызовов подряд. */
const CHUNK = 10
/** Минимум кейсов в группе для новой сборки плейбука. */
const MIN_BUILD = 3
/** Дайджест одного кейса в промпте не длиннее: сумма всех дайджестов остаётся в `PORTION_CHARS`. */
const BLOCK_CHARS = PORTION_CHARS / 20
/** Столько после провала сборки та же группа заново не собирается. */
const FAILED_BUILD_MS = 24 * 3600 * 1000

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const caseBlock = (ctx: JobContext, c: CaseState): string => {
	const text = `CASE ${c.id}${c.title ? ` — ${c.title}` : ''}\n${caseDigest(ctx.cases.summary(c.id))}`
	return text.length > BLOCK_CHARS ? `${text.slice(0, BLOCK_CHARS)}…` : text
}

const members = (p: PlaybookState): string[] => [...p.cases, ...(p.heldOut ? [p.heldOut] : [])]

/** Плейбук группы: названный матчером или тот, в чьих кейсах (`cases`/`heldOut`) уже не меньше половины кейсов группы. */
function playbookOf(playbooks: NonNullable<JobContext['playbooks']>, named: string | null, ids: readonly string[]): PlaybookState | null {
	const known = named === null ? null : playbooks.get(named)
	if (known) return known
	let best: PlaybookState | null = null
	let bestN = 0
	for (const p of playbooks.list()) {
		const have = new Set(members(p))
		const n = ids.filter(id => have.has(id)).length
		if (n > bestN && n * 2 >= ids.length) {
			best = p
			bestN = n
		}
	}
	return best
}

/** Сборка этой группы недавно провалилась окончательно: у группы ≥ 2/3 кейсов общие с провалившейся. */
function failedRecently(ctx: JobContext, ids: readonly string[]): boolean {
	return (ctx.failedBuilds?.() ?? []).some(f => ctx.now() - f.at < FAILED_BUILD_MS && ids.filter(id => f.cases.includes(id)).length * 3 >= ids.length * 2)
}

/** Новые кейсы пачками по `CHUNK`: у каждого свои ближайшие соседи (round-robin, чтобы бюджет делился поровну). */
function neighbours(ctx: JobContext, ready: readonly CaseState[], chunk: readonly CaseState[]): CaseState[] {
	const ids = new Set(chunk.map(c => c.id))
	const older = ready.filter(c => !ids.has(c.id))
	const index = buildIndex(older.map(c => ({ id: c.id, text: caseDigest(ctx.cases.summary(c.id)) })))
	const lists = chunk.map(c => search(index, caseDigest(ctx.cases.summary(c.id)), NEIGHBOURS).map(h => h.id))
	const picked: string[] = []
	for (let i = 0; i < NEIGHBOURS; i++) for (const l of lists) if (l[i] !== undefined && !picked.includes(l[i] as string)) picked.push(l[i] as string)
	return picked.flatMap(id => older.find(c => c.id === id) ?? [])
}

/**
 * Сопоставитель: кейсы одной задачи в группы; группа к плейбуку дополняет его, группа из ≥ 3 без плейбука ставит `build`.
 * `improve` отсюда не ставится: улучшение по поправкам ставит судья.
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
		if (fresh.length < 2 && !playbooks.list().length && ready.length < 2) {
			ctx.finish('сопоставлять не с чем')
			return
		}
		for (let at = 0; at < fresh.length; at += CHUNK) {
			const chunk = fresh.slice(at, at + CHUNK)
			// ближайшие по тексту дайджеста готовые кейсы к каждому новому; без соседей, плейбуков и пары — спрашивать нечего
			const candidates = neighbours(ctx, ready, chunk)
			const all = playbooks.list()
			if (!candidates.length && chunk.length < 2 && !all.length) continue
			const newBlocks = chunk.map(c => caseBlock(ctx, c))
			const listing = all.length ? all.map(p => `${p.id} | type: ${p.taskType} | ${p.description}`).join('\n') : '(none)'
			// всё, что уходит агенту, в пределах PORTION_CHARS: кандидаты берутся, пока есть место
			let left = PORTION_CHARS - listing.length - newBlocks.reduce((n, b) => n + b.length + 2, 0)
			const blocks: string[] = []
			for (const c of candidates) {
				const b = caseBlock(ctx, c)
				if (b.length + 2 > left) break
				blocks.push(b)
				left -= b.length + 2
			}
			const prompt = fillPrompt(ctx.prompt('matcher'), {
				new_case: newBlocks.join('\n\n'),
				candidates: blocks.length ? blocks.join('\n\n') : '(none)',
				playbooks: listing,
			})
			const res = await ctx.runAgent('matcher', `Сопоставление кейсов: ${chunk.length}`, prompt)
			const groups = parseMatch(res.text)
			if (!groups) throw new Error('в ответе нет <result> со списком групп')
			apply(ctx, playbooks, ready, new Set(chunk.map(c => c.id)), groups)
		}
		ctx.finish()
	},
}

/** Группы ответа: к плейбуку — `addCases`, иначе (≥ 3 кейсов, не повтор, не недавний провал) — `build`. */
function apply(ctx: JobContext, playbooks: NonNullable<JobContext['playbooks']>, ready: readonly CaseState[], freshIds: ReadonlySet<string>, groups: readonly MatchGroup[]): void {
	const readyIds = new Set(ready.map(c => c.id))
	for (const g of groups) {
		// названный кейс, которого нет или он не `ready`, выбрасывается
		const cases: Evidence[] = g.cases.filter(e => readyIds.has(e.caseId) && ctx.cases.get(e.caseId)?.status === 'ready')
		const ids = [...new Set(cases.map(e => e.caseId))].sort()
		if (!ids.some(id => freshIds.has(id))) continue
		const known = playbookOf(playbooks, g.playbookId, ids)
		if (known) {
			const have = new Set(members(known))
			const added = ids.filter(id => !have.has(id))
			if (added.length) playbooks.addCases(known.id, added)
			continue
		}
		if (ids.length < MIN_BUILD) continue
		// та же группа уже стала плейбуком — повторно не собираем
		if (playbooks.list().some(p => sameSet(members(p), ids))) continue
		if (failedRecently(ctx, ids)) continue
		ctx.enqueue('build', `g-${groupHash(ids)}`, { payload: { task: g.task, taskType: g.taskType, playbookId: null, cases } })
	}
}
