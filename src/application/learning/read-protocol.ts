/**
 * Строгий протокол чтения сборщика: `case read` выдаёт блок, следующий блок — только после описания, принятого `case draft`.
 * Проверки описания — `domain/summary-gate`; принятое описание сразу пишется в `summary.md` (чекпоинт) и двигает `coveredUntil`.
 */
import type { CaseDraftResult, CaseReadBlock, JobView, RawEvent } from '../../../shared/types'
import { parseSummaryHeads } from '../../domain/collector'
import { renderPortion } from '../../domain/case-events'
import { AppError } from '../../domain/errors'
import { MAX_REJECTS } from '../../domain/learning-settings'
import type { GateIssue } from '../../domain/learning.types'
import { applyLadder, autoDescription, checkBlock, checkFinal, formatRejection, waiveSkipped } from '../../domain/summary-gate'
import type { CaseState, JobState, ProtocolHost, ProtocolState } from './learning.types'

/** Состояние шагов в начале задания: принято всё до `base`. */
export function initProtocol(base: number, total: number): ProtocolState {
	return { base, total, ackedUntil: base, acknowledged: 0, blocks: 0, pending: null, rejects: 0, exhausted: false, finalAccepted: false }
}

/** Принято событий этого задания / событий к обработке на старте. */
export function protocolProgress(job: JobState): { read: number; total: number } | null {
	const p = job.protocol
	return p ? { read: p.acknowledged, total: p.total } : null
}

/** `summarizing`, пока блок выдан и описание не принято; иначе `reading`. */
export function protocolPhase(job: JobState): JobView['phase'] {
	if (job.status !== 'running' || (job.kind !== 'collect' && job.kind !== 'close')) return null
	return job.protocol?.pending ? 'summarizing' : 'reading'
}

const CARD = [
	'PROTOCOL CARD. Be brief: what the block was about and what was solved, with anchors. Details come later. Before `nessy-orch case draft`:',
	'1. Every event of the block is cited as an anchor (n a–b) or listed under ### Skipped as "- n a–b — reason" (3+ words).',
	'2. Retell in your own words (no 200+ character copies, no "the text discusses"); an Actions item is at most 200 characters; the whole description at most 12000.',
	'3. User corrections go under ### User corrections (short quote, anchor); ticket keys, MR !N, URLs and paths in the items (warnings only).',
	'4. Submit the FULL description in the v2 format; keep earlier items. NO BLOCK IS CLOSED WITHOUT AN ACCEPTED SUMMARY.',
].join('\n')

export class ReadProtocol {
	constructor(private readonly host: ProtocolHost) {}

	private job(id: string): JobState {
		const job = this.host.collecting(id)
		if (!job) throw new AppError(409, 'no_job', `по кейсу ${id} нет идущего задания сбора`)
		return job
	}

	private state(job: JobState, c: CaseState): ProtocolState {
		if (!job.protocol) job.protocol = initProtocol(c.coveredUntil, this.host.readRaw(c.id, c.coveredUntil + 1).length)
		return job.protocol
	}

	/** Следующий блок после принятого (≤ `blockEvents` событий и ≤ `blockChars` знаков из настроек, одно событие всегда). */
	read(id: string): CaseReadBlock {
		const c = this.host.getCase(id)
		const job = this.job(id)
		const p = this.state(job, c)
		this.host.touch(id)
		if (p.pending) {
			throw new AppError(
				409,
				'summary_required',
				`Block n ${p.pending.from}–${p.pending.until} has no accepted summary yet. Submit the updated summary with 'nessy-orch case draft' (every event of the block cited as n a–b, or listed under ### Skipped with a reason) before reading further.`,
			)
		}
		const events = this.host.readRaw(id, p.ackedUntil + 1)
		if (!events.length) {
			this.host.changed(job)
			return {
				text: '',
				header: '',
				card: `All blocks are acknowledged (n ${p.base + 1}–${p.ackedUntil}). Consolidate the description (merge duplicate items, close open questions, check the user corrections), end it with the \`## Brief\` section (gist, entities, skeleton) and submit it with 'nessy-orch case draft --final'.`,
				from: 0,
				until: p.ackedUntil,
				total: p.total,
				remaining: 0,
				done: true,
			}
		}
		const limits = this.host.blockLimits()
		const portion = renderPortion(events.slice(0, limits.events), limits.chars)
		p.pending = { from: portion.from, until: portion.until, text: portion.text }
		this.host.changed(job)
		this.host.log('info', id, `«${this.host.title(id)}»: блок ${p.blocks + 1} — события ${portion.from}–${portion.until}`)
		return {
			text: portion.text,
			header: `BLOCK ${p.blocks + 1} (n ${portion.from}–${portion.until}), events ${p.acknowledged}/${p.total} acknowledged`,
			card: CARD,
			from: portion.from,
			until: portion.until,
			total: p.total,
			remaining: events.filter(e => e.n > portion.until).length,
			done: false,
		}
	}

	/** Полное описание за выданный блок (`final` — итоговая консолидация после `done`): принято, либо 422 `rejected` со всеми нарушениями. */
	draft(id: string, input: string, final: boolean): CaseDraftResult {
		let text = input
		const c = this.host.getCase(id)
		const job = this.job(id)
		const p = this.state(job, c)
		const prev = this.host.readSummary(id)
		this.host.touch(id)
		let block: { from: number; until: number }
		let issues: GateIssue[]
		let events: RawEvent[] = []
		if (final) {
			const left = this.host.readRaw(id, p.ackedUntil + 1).length
			if (p.pending || left)
				throw new AppError(
					409,
					'not_done',
					`Blocks remain (${p.pending ? `block n ${p.pending.from}–${p.pending.until} awaits a summary` : `${left} events unread`}). --final is allowed only after 'nessy-orch case read' reports done.`,
				)
			block = { from: p.base + 1, until: p.ackedUntil }
			issues = checkFinal({ text, prev, until: p.ackedUntil })
		} else {
			if (!p.pending)
				throw new AppError(
					409,
					'no_block',
					"No block awaits a summary. Read the next block with 'nessy-orch case read' (after 'done' submit 'nessy-orch case draft --final').",
				)
			block = { from: p.pending.from, until: p.pending.until }
			events = this.host.readRaw(id, block.from, block.until)
			issues = checkBlock({ text, prev, events, from: block.from, until: block.until })
		}
		// лестница смягчения: сколько заданий подряд уже исчерпали отказы на этом блоке (итог — ключ 0)
		const key = final ? 0 : block.from
		const fails = c.blockFails?.from === key ? c.blockFails.fails : 0
		const { hard, warnings } = applyLadder(issues, fails, final)
		let note = ''
		if (hard.length && fails < 2) {
			p.rejects += 1
			let msg = formatRejection(hard, p.rejects, MAX_REJECTS)
			if (p.rejects >= MAX_REJECTS) {
				p.exhausted = true
				msg += ' Attempt limit reached: this job fails and a fresh agent continues from the last accepted block. Stop now.'
				this.host.update({ ...this.host.getCase(id), blockFails: { from: key, fails: fails + 1 } })
				if (job.agentId) this.host.cancelAgent(job.agentId)
			}
			this.host.changed(job)
			const what = final ? 'итоговое описание' : `саммари блока ${p.blocks + 1}`
			const why = hard.map(i => `${i.code}: ${i.text.length > 70 ? `${i.text.slice(0, 70)}…` : i.text}`).join('; ')
			this.host.log('warn', id, `«${this.host.title(id)}»: ${what} отклонено (попытка ${p.rejects}/${MAX_REJECTS}): ${why}`)
			if (p.exhausted) this.host.log('warn', id, `«${this.host.title(id)}»: лимит отказов, агент снят, продолжит новый`)
			throw new AppError(422, 'rejected', msg, { attempt: p.rejects, issues: hard.map(i => i.code) })
		}
		if (hard.length) {
			// последняя ступень: структура или якоря не прошли (пусто/мусор) — сервер сам формирует минимальное описание
			text = final ? prev : autoDescription(prev, events)
			note = ' (gate waived after repeated rejections: description built by the server, marked (auto))'
		} else if (fails >= 2) {
			if (!final) text = waiveSkipped(text, events)
			if (issues.length) note = ' (gate waived after repeated rejections)'
		} else if (warnings.length) {
			note = ` with warnings: ${warnings.map(i => `${i.code}: ${i.text}`).join(' | ')}`
		}
		if (!this.host.writeSummary(id, text)) throw new AppError(500, 'write_failed', 'не удалось записать summary.md')
		this.host.writeDraft(id, text)
		const now = this.host.now()
		const latest = this.host.getCase(id)
		const goals = parseSummaryHeads(text).goals
		this.host.update({
			...latest,
			coveredUntil: Math.max(latest.coveredUntil, block.until),
			goals: goals.length ? goals : latest.goals,
			lastRunAt: now,
			updatedAt: new Date(now).toISOString(),
			blockFails: { from: 0, fails: 0 },
		})
		p.rejects = 0
		const blockNo = p.blocks + 1
		if (final) {
			p.finalAccepted = true
		} else if (p.pending) {
			p.acknowledged += events.length
			p.blocks += 1
			p.ackedUntil = p.pending.until
			p.pending = null
		}
		this.host.touch(id)
		this.host.changed(job)
		const remaining = this.host.readRaw(id, p.ackedUntil + 1).length
		const title = this.host.title(id)
		const waived = hard.length
			? ' (описание собрано сервером после повторных отказов)'
			: fails >= 2
				? ' (проверки смягчены после повторных отказов)'
				: warnings.length
					? ` (замечания ${warnings.map(i => i.code).join(', ')})`
					: ''
		if (final) this.host.log(waived ? 'warn' : 'info', id, `«${title}»: итоговое описание принято${waived}`)
		else this.host.log(waived ? 'warn' : 'info', id, `«${title}»: саммари блока ${blockNo} принято, ${p.acknowledged} из ${p.total}${waived}`)
		const message = final
			? `ACCEPTED${note}: final description saved. The job is complete; stop.`
			: `ACCEPTED${note}: block n ${block.from}–${block.until} closed. ${remaining ? "Read the next block with 'nessy-orch case read'." : "No events left: run 'nessy-orch case read' (it reports done), then submit 'nessy-orch case draft --final'."}`
		return { ok: true, final, accepted: block, remaining, message }
	}
}
