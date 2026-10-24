import type { Evidence, RuleView } from '../../../shared/types'
import { fillPrompt, parseBuild } from '../../domain/learning-replies'
import { renderDocument } from '../../domain/playbook-document'
import type { BuildDraft, GroupMember } from '../../domain/playbook.types'
import { gatherMaterials, groupHash, membersOf } from './build.handler'
import type { JobHandler } from './handlers.types'
import type { FoldRef, PlaybookState } from './learning.types'
import { memberKey, validMembers } from './match.handler'
import { mergeReviewPayload, ruleIdOf, untilRemoved } from './playbook-edits'
import { playbookView } from './playbook.service'
import { payloadStr } from './payload'

type Payload = Record<string, unknown> | null

/** Сводит `payload` ждущего `absorb` с новым: члены объединяются без повторов пары «кейс + цель». */
export function mergeAbsorbPayload(a: Payload, b: Payload): Payload {
	if (!a) return b
	if (!b) return a
	const out: GroupMember[] = []
	for (const m of [...membersOf(a), ...membersOf(b)]) {
		const same = out.find(x => x.caseId === m.caseId && x.goal === m.goal)
		if (same) same.anchors = [...new Set([...same.anchors, ...m.anchors])]
		else out.push({ ...m })
	}
	return { ...a, members: out }
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()

const union = (a: readonly Evidence[], b: readonly Evidence[]): Evidence[] => {
	const out = [...a]
	for (const e of b) if (!out.some(x => x.caseId === e.caseId && x.anchor === e.anchor)) out.push(e)
	return out
}

/**
 * Правила обновлённого черновика поверх существующих: по `id` или по тексту — то же правило (счётчики целы, доказательства
 * дополняются); новые — кандидаты (или активные при ≥ 2 кейсах); не упомянутые остаются как были.
 */
export function mergeRules(p: PlaybookState, draft: BuildDraft, known: ReadonlySet<string>, iso: string): RuleView[] {
	const byId = new Map(p.rules.map(r => [r.id, r]))
	const touched = new Set<string>()
	const out: RuleView[] = []
	for (const d of draft.rules) {
		const evidence = d.evidence.filter(e => known.has(e.caseId))
		const old = (d.id ? byId.get(d.id) : undefined) ?? p.rules.find(r => !touched.has(r.id) && norm(r.text) === norm(d.text))
		if (old && !touched.has(old.id)) {
			touched.add(old.id)
			out.push({ ...old, text: d.text, stage: d.stage, evidence: union(old.evidence, evidence) })
			continue
		}
		const id = ruleIdOf(p.id, d.text)
		if (touched.has(id) || byId.has(id)) continue
		touched.add(id)
		out.push({
			id,
			text: d.text,
			stage: d.stage,
			status: new Set(evidence.map(e => e.caseId)).size >= 2 ? 'active' : 'candidate',
			up: 2,
			down: 0,
			evidence,
			against: [],
			lastAppliedAt: null,
			createdAt: iso,
		})
	}
	// порядок прежний: сначала прежние (обновлённые или нетронутые), затем новые
	const fresh = out.filter(r => !byId.has(r.id))
	const merged = p.rules.map(r => out.find(o => o.id === r.id) ?? r)
	return [...merged, ...fresh]
}

/**
 * Вливание: билдер получает существующий плейбук и материалы новых членов группы и возвращает обновлённый черновик;
 * результат — новая версия плейбука. Живой плейбук проходит ревью как правка (откат при провале), прочий — обычное ревью.
 * Влитые цели ждут свёртки (`fold`) до выхода плейбука в работу или до конца ревью правки.
 */
export const absorbHandler: JobHandler = {
	kinds: ['absorb'],
	run: ctx =>
		untilRemoved(ctx, async () => {
			const ps = ctx.playbooks
			const id = payloadStr(ctx.job.payload, 'playbookId')
			const p0 = ps?.get(id)
			if (!ps || !p0) {
				ctx.finish('плейбук не найден')
				return
			}
			// кейсы, которые уже в плейбуке, повторно не вливаются
			const members = validMembers(ctx, membersOf(ctx.job.payload)).filter(m => !p0.cases.includes(m.caseId) && p0.heldOut !== m.caseId)
			if (!members.length) {
				ctx.finish('нечего вливать')
				return
			}
			const used = [...new Set(members.map(m => m.caseId))].sort()
			const anchorsOf = (cid: string): string[] => members.filter(m => m.caseId === cid).flatMap(m => m.anchors)
			const materials = await gatherMaterials(ctx, used, anchorsOf)
			const notes = ps.notes(id).trim()
			const others = ps.list().filter(o => o.id !== id)
			const task = payloadStr(ctx.job.payload, 'task') || p0.title
			const prompt = fillPrompt(ctx.prompt('playbook-builder'), {
				group: [
					`Task: ${task}`,
					`Task type: ${payloadStr(ctx.job.payload, 'taskType') || p0.taskType}`,
					`Update of playbook ${id}`,
					...members.map(m => `CASE ${m.caseId} goal "${m.goal}": ${m.anchors.join(', ')}`),
				].join('\n'),
				existing_playbook: renderDocument(playbookView(p0), notes),
				materials,
				notes: notes ? `[${id}] ${notes}` : '(none)',
				existing: others.length ? others.map(o => `${o.id}: ${o.description}`).join('\n') : '(none)',
			})
			const res = await ctx.runAgent(`playbook-absorb-${groupHash(used)}`, `Обновление плейбука: ${p0.title}`.slice(0, 80), prompt)
			const draft = parseBuild(res.text)
			if (!draft) throw new Error('в ответе сборщика нет корректного <result>')
			// пока агент работал, плейбук могли поменять руками
			const p = ps.need(id)
			const iso = new Date(ctx.now()).toISOString()
			const live = p.status === 'trial' || p.status === 'active'
			const auto = ctx.settings().autoReview
			const hash = live && auto ? `absorb-${memberKey(members)}` : undefined
			const refs: FoldRef[] = members.map(m => ({ caseId: m.caseId, goal: m.goal, ...(hash ? { hash } : {}) }))
			const known = new Set([...p.cases, ...(p.heldOut ? [p.heldOut] : []), ...used])
			const sessions = used.map(c => `«${ctx.cases.sessionTitle(c)}»`).join(', ')
			const next: PlaybookState = {
				...p,
				title: p.title,
				description: draft.description,
				taskType: draft.taskType || p.taskType,
				params: draft.params,
				sources: draft.sources,
				files: draft.files,
				behavior: draft.behavior,
				stages: draft.stages,
				tools: draft.tools?.length ? draft.tools : (p.tools ?? []),
				rules: mergeRules(p, draft, known, iso),
				cases: [...p.cases, ...used],
				// живой плейбук без авто-ревью снимается с публикации: правка ждёт человека
				status: live && !auto ? 'review' : p.status,
				folds: [...(p.folds ?? []), ...refs],
			}
			const saved = ps.saveVersion(next, `Absorb from ${used.join(', ')}`, {
				kind: 'version',
				subject: id,
				summary: `${id}: влито из сессий ${sessions} (${members.length} ${members.length === 1 ? 'цель' : 'целей'})`,
				report: null,
				revertible: true,
				revertedBy: null,
			})
			ctx.log('info', id, `Плейбук «${p.title}» обновлён по сессии ${sessions}`)
			if (hash) ctx.enqueue('review', id, { payload: { edits: [hash], baseVersion: p.version }, merge: mergeReviewPayload })
			else if (!live) ctx.enqueue('review', saved.id, {})
			ctx.finish()
		}),
}
