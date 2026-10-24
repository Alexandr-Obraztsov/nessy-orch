import type { Evidence } from '../../../shared/types'
import { fillPrompt, MATCH_ACTIONS, parseGroupVerdict } from '../../domain/learning-replies'
import type { GroupMember, MatchAction, MatchDecision } from '../../domain/playbook.types'
import { groupHash, membersOf, sameSet } from './build.handler'
import type { JobContext, JobHandler } from './handlers.types'
import { MIN_BUILD, failedRecently, memberKey, validMembers } from './match.handler'
import { mergeAbsorbPayload } from './absorb.handler'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Решение из `payload` задания `verify`; битое — null. */
function decisionOf(ctx: JobContext): MatchDecision | null {
	const p = ctx.job.payload
	const action = MATCH_ACTIONS.find((a): a is MatchAction => a === p?.['action'])
	const members = membersOf(p)
	if (!action || !members.length) return null
	const playbookId = str(p?.['playbookId'])
	return { task: str(p?.['task']), taskType: str(p?.['taskType']), action, playbookId: playbookId === '' ? null : playbookId, members, reason: str(p?.['reason']) }
}

/** Текст предложения для проверяющего. */
function proposal(ctx: JobContext, d: MatchDecision): string {
	const lines = [`Task: ${d.task}`, `Task type: ${d.taskType}`, `Action: ${d.action}`, `Playbook: ${d.playbookId ?? '(none: a new playbook)'}`, `Matcher's reason: ${d.reason || '(none)'}`, 'Members (session + goal, anchors of the common part):']
	for (const m of d.members) lines.push(`- case ${m.caseId} "${ctx.cases.sessionTitle(m.caseId)}", goal "${m.goal}", anchors ${m.anchors.join(', ')}`)
	return lines.join('\n')
}

/** Сколько членов (кейсов) нужно, чтобы группа была годной. */
const needed = (a: MatchAction): number => (a === 'new_playbook' ? MIN_BUILD : 1)

/** Члены в формате доказательств: по якорю на каждый. */
const evidenceOf = (ms: readonly GroupMember[]): Evidence[] => ms.flatMap(m => m.anchors.map(anchor => ({ caseId: m.caseId, anchor })))

/**
 * Проверка группы вторым проходом: свежий агент читает полные описания всех членов (`case show`, `playbook show`).
 * `confirm` — дальше (`build` или `absorb`), `split` — оставить подмножество, если оно годится, `reject` — группа отброшена.
 */
export const verifyHandler: JobHandler = {
	kinds: ['verify'],
	async run(ctx) {
		const playbooks = ctx.playbooks
		const d = decisionOf(ctx)
		if (!playbooks || !d) {
			ctx.finish('нет группы или хранилища плейбуков')
			return
		}
		let ms = validMembers(ctx, d.members)
		const key = ctx.job.caseId || ms[0]?.caseId || ''
		if (new Set(ms.map(m => m.caseId)).size < needed(d.action)) {
			ctx.finish('в группе не хватает существующих сессий')
			return
		}
		const known = d.playbookId === null ? null : playbooks.get(d.playbookId)
		if (d.action !== 'new_playbook' && !known) {
			ctx.finish('плейбук группы не найден')
			return
		}
		const res = await ctx.runAgent(`group-verifier-${memberKey(ms)}`, `Проверка группы: ${d.task}`.slice(0, 80), fillPrompt(ctx.prompt('group-verifier'), { group: proposal(ctx, { ...d, members: ms }) }))
		const verdict = parseGroupVerdict(res.text)
		if (!verdict) throw new Error('в ответе проверки группы нет корректного <result>')
		if (verdict.verdict === 'reject') {
			ctx.log('info', key, `Проверка группы «${d.task}»: отклонена${verdict.reason ? `: ${verdict.reason}` : ''}`)
			ctx.finish('группа отклонена')
			return
		}
		if (verdict.verdict === 'split') {
			const keep = new Set((verdict.members ?? []).map(m => `${m.caseId}#${m.goal.trim().toLowerCase()}`))
			ms = ms.filter(m => keep.has(`${m.caseId}#${m.goal.trim().toLowerCase()}`))
			if (new Set(ms.map(m => m.caseId)).size < needed(d.action)) {
				ctx.log('info', key, `Проверка группы «${d.task}»: отклонена, после разделения членов меньше порога`)
				ctx.finish('после разделения членов меньше порога')
				return
			}
			ctx.log('info', key, `Проверка группы «${d.task}»: оставлено ${ms.length} членов из ${d.members.length}`)
		} else ctx.log('info', key, `Проверка группы «${d.task}»: подтверждена`)

		const ids = [...new Set(ms.map(m => m.caseId))].sort()
		if (d.action === 'new_playbook') {
			// пока шла проверка, плейбук с этими кейсами мог появиться или сборка провалиться
			if (playbooks.list().some(p => sameSet([...p.cases, ...(p.heldOut ? [p.heldOut] : [])], ids))) {
				ctx.finish('плейбук с этими кейсами уже есть')
				return
			}
			if (failedRecently(ctx, ids)) {
				ctx.finish('сборка этой группы недавно провалилась')
				return
			}
			ctx.enqueue('build', `g-${groupHash(ids)}`, { payload: { task: d.task, taskType: d.taskType, playbookId: null, cases: evidenceOf(ms), members: ms } })
		} else if (d.playbookId !== null) {
			ctx.enqueue('absorb', `absorb:${d.playbookId}`, { payload: { playbookId: d.playbookId, action: d.action, task: d.task, taskType: d.taskType, members: ms }, merge: mergeAbsorbPayload })
		}
		ctx.finish()
	},
}
