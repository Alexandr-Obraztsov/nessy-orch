/**
 * Команды фонового обучения:
 *   learn [status] | on | off [--session S] | run [--session S] | backfill [--all | <id…>]
 *   case ls | show <id> | rm <id> | rebuild <id>
 */
import type { BackfillCandidate, BackfillResult, CaseDetail, JobView, LearningSettings, LearningView } from '../../../../shared/types'
import { flagBool, flagStr } from '../args'
import type { FlagSpec, Parsed } from '../args.types'
import { CliError } from '../errors'
import { bold, candidatesTable, casesTable, dim, green, jobsTable } from '../format'
import { del, enc, get, json, out, patch, post } from '../io'
import type { CommandTable } from './command.types'

export const LEARN_FLAGS: FlagSpec = { bool: ['json', 'help', 'all'], value: ['session'], short: { a: 'all' } }
export const CASE_FLAGS: FlagSpec = { bool: ['json', 'help'] }

const LEARN_USAGE = `использование:
  nessy-orch learn [status] | on | off [--session S] | run [--session S]
  nessy-orch learn backfill [--all | <id…>]`
const CASE_USAGE = `использование:
  nessy-orch case ls | show <id> | rm <id> | rebuild <id>`

function settingsLine(s: LearningSettings): string {
	const off = s.disabledSessions.length ? ` · выключено для: ${s.disabledSessions.join(', ')}` : ''
	return `обучение ${s.enabled ? green('включено') : 'выключено'} · авторевью ${s.autoReview ? 'да' : 'нет'} · сбор раз в ${s.intervalMin} мин · простой ${s.idleMin} мин · агентов ${s.maxAgents}${off}`
}

function printStatus(v: LearningView): void {
	out(settingsLine(v.settings))
	const active = v.jobs.filter(j => j.status !== 'done')
	out(`\n${bold('Очередь')}  ${dim(`активных заданий: ${active.length}, всего в истории: ${v.jobs.length}`)}`)
	if (active.length) out(jobsTable(active))
	out(`\n${bold('Кейсы')}  ${dim(`всего: ${v.cases.length}`)}`)
	out(casesTable(v.cases.slice(0, 10)))
	if (v.cases.length > 10) out(dim(`… ещё ${v.cases.length - 10}: nessy-orch case ls`))
}

function printCase(c: CaseDetail): void {
	out(`${bold(c.id)}  ${c.status}  ${c.title ?? dim('без заголовка')}`)
	out(dim(`источник: ${c.source === 'backfill' ? 'разбор прошлого' : 'живая сессия'} · сессии: ${c.sessions.join(', ') || '—'} · события ${c.coveredUntil}/${c.events}`))
	out(dim(`создан ${c.createdAt} · обновлён ${c.updatedAt}${c.closedAt ? ` · закрыт ${c.closedAt}` : ''}`))
	if (c.goals.length) out(dim(`цели: ${c.goals.map(g => `${g.title} (${g.type})`).join('; ')}`))
	out('')
	out(c.summary.trim() ? c.summary.trim() : dim('summary.md пока нет'))
}

async function setEnabled(p: Parsed, enabled: boolean): Promise<void> {
	const session = flagStr(p, 'session')
	let body: Partial<LearningSettings>
	if (session === undefined) body = { enabled }
	else {
		const cur = (await get<LearningView>('/learning')).settings.disabledSessions
		body = { disabledSessions: enabled ? cur.filter(x => x !== session) : [...new Set([...cur, session])] }
	}
	const s = await patch<LearningSettings>('/learning/settings', body)
	if (flagBool(p, 'json')) return json(s)
	out(`${green('✓')} ${session === undefined ? `обучение ${enabled ? 'включено' : 'выключено'}` : `сессия ${session}: обучение ${enabled ? 'включено' : 'выключено'}`}`)
}

async function cmdLearn(p: Parsed): Promise<void> {
	const [sub = 'status', ...rest] = p.positionals
	const asJson = flagBool(p, 'json')
	if (sub === 'status') {
		const v = await get<LearningView>('/learning')
		return asJson ? json(v) : printStatus(v)
	}
	if (sub === 'on' || sub === 'off') return setEnabled(p, sub === 'on')
	if (sub === 'run') {
		const session = flagStr(p, 'session')
		const jobs = await post<JobView[]>('/learning/run', session === undefined ? {} : { session })
		if (asJson) return json(jobs)
		return out(jobs.length ? `${green('✓')} заданий поставлено: ${jobs.length}\n${jobsTable(jobs)}` : dim('открытых кейсов нет'))
	}
	if (sub === 'backfill') {
		const list = await get<BackfillCandidate[]>('/learning/backfill')
		const ids = flagBool(p, 'all') ? list.map(x => x.id) : rest
		if (!ids.length) return asJson ? json(list) : out(`${candidatesTable(list)}\n${list.length ? dim('разобрать: nessy-orch learn backfill --all | <id…>') : ''}`.trimEnd())
		const r = await post<BackfillResult>('/learning/backfill', { ids })
		if (asJson) return json(r)
		out(`${green('✓')} кейсов заведено: ${r.created.length}${r.created.length ? ` (задания close в очереди)\n${casesTable(r.created)}` : ''}`)
		for (const s of r.skipped) out(dim(`пропущен ${s.id}: ${s.reason}`))
		return
	}
	throw new CliError(`неизвестная подкоманда learn ${sub}\n${LEARN_USAGE}`, 2)
}

function needId(id: string | undefined, sub: string): string {
	if (!id) throw new CliError(`использование: nessy-orch case ${sub} <id>`, 2)
	return id
}

async function cmdCase(p: Parsed): Promise<void> {
	const [sub = 'ls', ...rest] = p.positionals
	const asJson = flagBool(p, 'json')
	if (sub === 'ls') {
		const v = await get<LearningView>('/learning')
		return asJson ? json(v.cases) : out(casesTable(v.cases))
	}
	if (sub === 'show') {
		const c = await get<CaseDetail>(`/learning/cases/${enc(needId(rest[0], 'show'))}`)
		return asJson ? json(c) : printCase(c)
	}
	if (sub === 'rm') {
		const id = needId(rest[0], 'rm')
		await del(`/learning/cases/${enc(id)}`)
		return asJson ? json({ ok: true }) : out(`${green('✓')} кейс удалён: ${id}`)
	}
	if (sub === 'rebuild') {
		const id = needId(rest[0], 'rebuild')
		const job = await post<JobView>(`/learning/cases/${enc(id)}/rebuild`, {})
		return asJson ? json(job) : out(`${green('✓')} пересборка кейса ${id}: задание ${job.id}`)
	}
	throw new CliError(`неизвестная подкоманда case ${sub}\n${CASE_USAGE}`, 2)
}

export const learningCommands: CommandTable = {
	learn: { run: cmdLearn, spec: LEARN_FLAGS },
	case: { run: cmdCase, spec: CASE_FLAGS },
}
