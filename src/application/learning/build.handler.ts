import { createHash } from 'node:crypto'
import type { Evidence } from '../../../shared/types'
import { parseAnchor, mergeRanges } from '../../domain/anchors'
import { renderPortion } from '../../domain/case-events'
import { fillPrompt, parseBuild, parseCaseAnalysis } from '../../domain/learning-replies'
import { BUILD_CHARS, PORTION_CHARS } from '../../domain/learning-settings'
import type { RawEvent } from '../../domain/learning.types'
import type { GroupMember, MatchGroup, Range } from '../../domain/playbook.types'
import type { JobContext, JobHandler } from './handlers.types'

/** Запас вокруг якоря: события до и после общей части. */
const PAD = 3
/** Бесконечный предел порции: весь текст разом. */
const UNLIMITED = Number.MAX_SAFE_INTEGER

/** Хэш группы: от отсортированных id кейсов. */
export function groupHash(ids: readonly string[]): string {
	return createHash('sha1').update([...ids].sort().join('\n')).digest('hex').slice(0, 8)
}

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
	const sa = new Set(a)
	const sb = new Set(b)
	return sa.size === sb.size && [...sa].every(x => sb.has(x))
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Члены группы из `payload` (`members`): их цели после выхода плейбука в работу сворачиваются. */
export function membersOf(payload: Record<string, unknown> | null): GroupMember[] {
	const raw = payload?.['members']
	if (!Array.isArray(raw)) return []
	const out: GroupMember[] = []
	for (const m of raw) {
		if (!isObject(m) || typeof m['caseId'] !== 'string' || typeof m['goal'] !== 'string') continue
		out.push({ caseId: m['caseId'], goal: m['goal'], anchors: Array.isArray(m['anchors']) ? m['anchors'].filter((a): a is string => typeof a === 'string') : [] })
	}
	return out
}

/** Группа из `payload` задания; битая — null. */
function groupOf(payload: Record<string, unknown> | null): MatchGroup | null {
	if (!payload || !Array.isArray(payload['cases'])) return null
	const cases: Evidence[] = []
	for (const e of payload['cases']) {
		if (isObject(e) && typeof e['caseId'] === 'string' && typeof e['anchor'] === 'string') cases.push({ caseId: e['caseId'], anchor: e['anchor'] })
	}
	const task = payload['task']
	const taskType = payload['taskType']
	return { task: typeof task === 'string' ? task : '', taskType: typeof taskType === 'string' ? taskType : '', playbookId: null, cases }
}

/** События кейса по объединённым якорям группы (с запасом `PAD`). */
function eventsOf(ctx: JobContext, caseId: string, anchors: readonly string[]): RawEvent[] {
	const ranges: Range[] = []
	for (const a of anchors) {
		const r = parseAnchor(a)
		if (r) ranges.push(r)
	}
	const out: RawEvent[] = []
	for (const r of mergeRanges(ranges, PAD)) out.push(...ctx.cases.raw(caseId, r.from, r.to))
	return out
}

/** Материалы по якорям: сырые события, а при большом объёме — разбор каждого кейса отдельным агентом (`case-analyst`). */
export async function gatherMaterials(ctx: JobContext, used: readonly string[], anchorsOf: (id: string) => string[]): Promise<string> {
	const events = new Map(used.map(id => [id, eventsOf(ctx, id, anchorsOf(id))]))
	const rendered = used.map(id => ({ id, text: renderPortion(events.get(id) ?? [], UNLIMITED).text }))
	const total = rendered.reduce((n, r) => n + r.text.length, 0)
	if (total <= BUILD_CHARS) return rendered.map(r => `### CASE ${r.id} (${anchorsOf(r.id).join(', ')})\n${r.text}`).join('\n\n')
	const parts: string[] = []
	for (const id of used) {
		let rest = events.get(id) ?? []
		const analyses: string[] = []
		while (rest.length) {
			const portion = renderPortion(rest, PORTION_CHARS)
			rest = rest.filter(e => e.n > portion.until)
			const prompt = fillPrompt(ctx.prompt('case-analyst'), { case_id: id, summary: ctx.cases.summary(id), events: portion.text })
			const res = await ctx.runAgent(`case-analyst-${id}`, `Разбор кейса ${id}`, prompt)
			const a = parseCaseAnalysis(res.text)
			if (!a) throw new Error(`в ответе разбора кейса ${id} нет <result>`)
			analyses.push(a.analysis)
		}
		parts.push(`### ANALYSIS of case ${id} (${anchorsOf(id).join(', ')})\n${analyses.join('\n\n')}`)
	}
	return parts.join('\n\n')
}

/** Сборщик плейбука из группы кейсов: один агент, а при больших материалах — разбор каждого кейса и сборка по разборам. */
export const buildHandler: JobHandler = {
	kinds: ['build'],
	async run(ctx) {
		const playbooks = ctx.playbooks
		const group = groupOf(ctx.job.payload)
		if (!playbooks || !group) {
			ctx.finish('нет группы или хранилища плейбуков')
			return
		}
		const ready = (id: string): boolean => ctx.cases.get(id)?.status === 'ready'
		const evidence = group.cases.filter(e => ready(e.caseId))
		const ids = [...new Set(evidence.map(e => e.caseId))]
		if (ids.length < 3) {
			ctx.finish('в группе меньше 3 готовых кейсов')
			return
		}
		const exists = (): boolean => playbooks.list().some(p => sameSet([...p.cases, ...(p.heldOut ? [p.heldOut] : [])], ids))
		if (exists()) {
			ctx.finish('плейбук с этими кейсами уже есть')
			return
		}
		// отложенный кейс — самый свежий; сборка по остальным
		const fresh = (id: string): string => {
			const c = ctx.cases.get(id)
			return c?.closedAt ?? c?.updatedAt ?? ''
		}
		const heldOut = [...ids].sort((a, b) => fresh(b).localeCompare(fresh(a)) || b.localeCompare(a))[0] ?? null
		const used = ids.filter(id => id !== heldOut).sort()
		const anchorsOf = (id: string): string[] => evidence.filter(e => e.caseId === id).map(e => e.anchor)
		const materials = await gatherMaterials(ctx, used, anchorsOf)

		const notes = used.map(id => ({ id, text: ctx.cases.notes(id).trim() })).filter(n => n.text)
		const prompt = fillPrompt(ctx.prompt('playbook-builder'), {
			group: [`Task: ${group.task}`, `Task type: ${group.taskType}`, ...used.map(id => `CASE ${id}: ${anchorsOf(id).join(', ')}`)].join('\n'),
			materials,
			notes: notes.length ? notes.map(n => `[${n.id}] ${n.text}`).join('\n\n') : '(none)',
			existing_playbook: '(none)',
			existing: playbooks.list().length ? playbooks.list().map(p => `${p.id}: ${p.description}`).join('\n') : '(none)',
		})
		const res = await ctx.runAgent(`playbook-builder-${groupHash(ids)}`, `Сборка плейбука: ${group.task || group.taskType}`.slice(0, 80), prompt)
		const draft = parseBuild(res.text)
		if (!draft) throw new Error('в ответе сборщика нет корректного <result>')
		// пока агент работал, ту же группу мог собрать другой запуск
		if (exists()) {
			ctx.finish('плейбук с этими кейсами уже есть')
			return
		}
		const known = new Set(used)
		const rules = draft.rules.map(r => ({ ...r, evidence: r.evidence.filter(e => known.has(e.caseId)) }))
		const folds = membersOf(ctx.job.payload).filter(m => ids.includes(m.caseId)).map(m => ({ caseId: m.caseId, goal: m.goal }))
		const playbook = playbooks.create({ ...draft, cases: used, heldOut, rules }, { ...group, cases: evidence }, heldOut, folds)
		ctx.enqueue('review', playbook.id, {})
		ctx.finish()
	},
}
