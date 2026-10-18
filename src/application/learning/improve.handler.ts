import { createHash } from 'node:crypto'
import type { Evidence, PendingEdit } from '../../../shared/types'
import { fillPrompt, parseImprovement } from '../../domain/learning-replies'
import { similarity } from '../../domain/learning-search'
import { correctionsSection, eventsAround, anchorRanges, playbookIdOf } from './judge.handler'
import type { JobContext, JobHandler } from './handlers.types'
import { applyEdit, countOf, editableFiles, mergeReviewPayload, untilRemoved } from './playbook-edits'
import type { PlaybookState } from './learning.types'

/** Похожие по смыслу кандидаты сливаются (порог сходства текстов). */
const SAME_RULE = 0.8

/** Отпечаток правки: sha1 от файла, `before` и `after`; по нему отклонённые правки не предлагаются снова. */
export function editHash(e: { file: string; before: string; after: string }): string {
	return createHash('sha1').update(e.file + e.before + e.after).digest('hex')
}

const evidenceKey = (e: Evidence): string => `${e.caseId}|${e.anchor}`

/**
 * Улучшатель: по поправкам пользователя в кейсе с плейбуком предлагает правки файлов и правила-кандидаты.
 * С `autoReview: true` правки применяются: новая версия плейбука и задание `review` с отпечатками правок (`payload.edits`)
 * и номером версии до правки (`payload.baseVersion`): провал ревью откатывает версию (обработчик ревью).
 * С `autoReview: false` правки не применяются, а ложатся в `PlaybookState.pendingEdits` и ждут решения человека.
 */
export const improveHandler: JobHandler = {
	kinds: ['improve'],
	run: ctx => untilRemoved(ctx, () => improveJob(ctx)),
}

async function improveJob(ctx: JobContext): Promise<void> {
	const { job, playbooks } = ctx
	const c = ctx.cases.get(job.caseId)
	const start = c?.playbook && playbooks ? playbooks.get(playbookIdOf(c.playbook)) : null
	if (!c || !playbooks || !start) {
		ctx.finish('у кейса нет плейбука')
		return
	}
	const summary = ctx.cases.summary(c.id)
	const prompt = fillPrompt(ctx.prompt('improver'), {
		playbook: Object.entries(editableFiles(start))
			.map(([path, text]) => `--- FILE: ${path} ---\n${text}`)
			.join('\n\n'),
		summary,
		events: `CASE: ${c.id}\n${eventsAround(ctx, c.id, anchorRanges(correctionsSection(summary)))}`,
		rejected: start.rejectedEdits.length ? start.rejectedEdits.join('\n') : '(none)',
		notes: playbooks.notes(start.id),
	})
	const res = await ctx.runAgent(`improve-${c.id}`, `Улучшение плейбука: ${start.title}`, prompt)
	const imp = parseImprovement(res.text)
	if (!imp) throw new Error('в ответе улучшателя нет <result>')
	if (imp.cause === 'one_off') {
		ctx.finish('разовое пожелание')
		return
	}
	// пока агент думал, плейбук могли изменить: правки и версия считаются от свежего состояния (удалён — `no_playbook`)
	const p = playbooks.need(start.id)
	const files = editableFiles(p)
	const auto = ctx.settings().autoReview
	const iso = new Date(ctx.now()).toISOString()
	let next: PlaybookState = p
	// без автоприменения правки только проверяются на применимость, плейбук остаётся прежним
	let probe: PlaybookState = p
	const applied: string[] = []
	const pending: PendingEdit[] = [...(p.pendingEdits ?? [])]
	let queuedNow = 0
	const dropped: string[] = []
	for (const e of imp.edits) {
		const hash = editHash(e)
		// отклонённые и повторные правки отбрасывает код, а не агент
		if (p.rejectedEdits.includes(hash) || applied.includes(hash) || pending.some(x => x.hash === hash)) {
			dropped.push(`${e.file}: отклонена ранее`)
			continue
		}
		const file = files[e.file]
		if (file === undefined || countOf(file, e.before) !== 1) {
			dropped.push(`${e.file}: «before» не найден или не единственный`)
			continue
		}
		const edited = applyEdit(probe, e.file, e.before, e.after)
		if (!edited) {
			dropped.push(`${e.file}: «before» не лежит в одном поле плейбука`)
			continue
		}
		probe = edited
		if (auto) next = edited
		else {
			pending.push({ hash, file: e.file, before: e.before, after: e.after, anchor: e.anchor, caseId: c.id, createdAt: iso })
			queuedNow++
		}
		applied.push(hash)
	}
	let added = 0
	let rules = next.rules
	for (const cand of imp.candidates) {
		const same = rules.find(r => similarity(r.text, cand.text) >= SAME_RULE)
		if (same?.status === 'candidate') {
			const fresh = cand.evidence.filter(e => !same.evidence.some(x => evidenceKey(x) === evidenceKey(e)))
			if (fresh.length) {
				rules = rules.map(r => (r.id === same.id ? { ...r, evidence: [...r.evidence, ...fresh] } : r))
				added++
			}
		} else if (!same) {
			const id = `r-${createHash('sha1').update(`${p.id}\n${cand.text}`).digest('hex').slice(0, 6)}`
			if (rules.some(r => r.id === id)) continue
			rules = [...rules, { id, text: cand.text, stage: cand.stage, status: 'candidate', up: 2, down: 0, evidence: cand.evidence, against: [], lastAppliedAt: null, createdAt: iso }]
			added++
		}
	}
	const note = dropped.length ? `отброшено: ${dropped.join('; ')}` : undefined
	if (!applied.length && !added) {
		ctx.finish(dropped.length ? `нечего применять: ${dropped.join('; ')}` : 'изменений нет')
		return
	}
	if (!auto) {
		// правки ждут человека (вкладка «Ревью»); кандидаты в правила — новая версия без ревью
		if (added) playbooks.saveVersion({ ...next, rules, pendingEdits: pending }, `Improve from ${c.id}: ${added} rule candidates`, {
			kind: 'version',
			subject: p.id,
			summary: `${p.id}: улучшение по кейсу ${c.id} (кандидатов ${added}, правок на решение ${queuedNow})`,
			report: null,
			revertible: true,
			revertedBy: null,
		})
		else playbooks.setPendingEdits(p.id, pending)
		ctx.finish(`правок на решение: ${queuedNow}${note ? `; ${note}` : ''}`)
		return
	}
	const baseVersion = p.version
	const saved = playbooks.saveVersion({ ...next, rules }, `Improve from ${c.id}: ${applied.length} edits, ${added} rule candidates`, {
		kind: 'version',
		subject: p.id,
		summary: `${p.id}: улучшение по кейсу ${c.id} (правок ${applied.length}, кандидатов ${added})`,
		report: null,
		revertible: true,
		revertedBy: null,
	})
	ctx.enqueue('review', saved.id, { payload: { edits: applied, baseVersion }, merge: mergeReviewPayload })
	ctx.finish(note)
}
