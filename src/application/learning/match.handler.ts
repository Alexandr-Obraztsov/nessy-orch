import type { Evidence } from '../../../shared/types'
import { buildIndex, caseDigest, search } from '../../domain/learning-search'
import { fillPrompt, parseMatch } from '../../domain/learning-replies'
import { countCorrections } from '../../domain/rule-counters'
import type { MatchGroup } from '../../domain/playbook.types'
import type { CaseState } from './learning.types'
import type { JobContext, JobHandler } from './handlers.types'
import { groupHash, sameSet } from './build.handler'

/** Сколько ближайших кейсов поиск добавляет к каждому новому. */
const NEIGHBOURS = 20
/** Минимум кейсов в группе для новой сборки плейбука. */
const MIN_BUILD = 3

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const caseBlock = (ctx: JobContext, c: CaseState): string => `CASE ${c.id}${c.title ? ` — ${c.title}` : ''}\n${caseDigest(ctx.cases.summary(c.id))}`

/** Сопоставитель: кейсы одной задачи в группы; группа к плейбуку дополняет его, группа из ≥ 3 без плейбука ставит `build`. */
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
		const freshIds = new Set(fresh.map(c => c.id))
		// ближайшие по тексту дайджеста готовые кейсы к каждому новому
		const older = ready.filter(c => !freshIds.has(c.id))
		const index = buildIndex(older.map(c => ({ id: c.id, text: caseDigest(ctx.cases.summary(c.id)) })))
		const near = new Set<string>()
		for (const c of fresh) for (const hit of search(index, caseDigest(ctx.cases.summary(c.id)), NEIGHBOURS)) near.add(hit.id)
		const candidates = older.filter(c => near.has(c.id))
		const all = playbooks.list()
		if (!candidates.length && fresh.length < 2 && !all.length) {
			ctx.finish('сопоставлять не с чем')
			return
		}
		const prompt = fillPrompt(ctx.prompt('matcher'), {
			new_case: fresh.map(c => caseBlock(ctx, c)).join('\n\n'),
			candidates: candidates.length ? candidates.map(c => caseBlock(ctx, c)).join('\n\n') : '(none)',
			playbooks: all.length ? all.map(p => `${p.id} | type: ${p.taskType} | ${p.description}`).join('\n') : '(none)',
		})
		const res = await ctx.runAgent('matcher', `Сопоставление кейсов: ${fresh.length}`, prompt)
		const groups = parseMatch(res.text)
		if (!groups) throw new Error('в ответе нет <result> со списком групп')

		const readyIds = new Set(ready.map(c => c.id))
		for (const g of groups) {
			// названный кейс, которого нет или он не `ready`, выбрасывается
			const cases: Evidence[] = g.cases.filter(e => readyIds.has(e.caseId) && ctx.cases.get(e.caseId)?.status === 'ready')
			const ids = [...new Set(cases.map(e => e.caseId))].sort()
			if (!ids.some(id => freshIds.has(id))) continue
			const known = g.playbookId === null ? null : playbooks.get(g.playbookId)
			const group: MatchGroup = { ...g, playbookId: known?.id ?? null, cases }
			if (known) {
				const have = new Set([...known.cases, ...(known.heldOut ? [known.heldOut] : [])])
				const added = ids.filter(id => !have.has(id))
				if (added.length) playbooks.saveVersion({ ...known, cases: [...known.cases, ...added] }, `Cases added: ${added.join(', ')}`)
				// поправки в кейсе, который шёл по этому плейбуку, — материал для улучшения
				for (const id of ids) {
					const c = ctx.cases.get(id)
					if (!c || !freshIds.has(id) || c.playbook?.split('@')[0] !== known.id) continue
					if (countCorrections(ctx.cases.summary(id)) > 0) ctx.enqueue('improve', `improve:${id}`, { caseId: id })
				}
				continue
			}
			if (ids.length < MIN_BUILD) continue
			// та же группа уже стала плейбуком — повторно не собираем
			if (playbooks.list().some(p => sameSet([...p.cases, ...(p.heldOut ? [p.heldOut] : [])], ids))) continue
			ctx.enqueue('build', `g-${groupHash(ids)}`, { payload: { task: group.task, taskType: group.taskType, playbookId: null, cases: group.cases } })
		}
		ctx.finish()
	},
}
