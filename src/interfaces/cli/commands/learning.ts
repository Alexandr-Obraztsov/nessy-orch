/**
 * Команды фонового обучения:
 *   learn [status] | on | off [--session S] | run [--session S]
 *   learn journal [--limit N] [--revert <id>]
 *   case ls [--cards] | show <id> | rm <id> | rebuild <id> | note <id> "<текст>" | read <id> | draft <id> [--file F] [--final]
 *   playbook ls [--cards] | show <id> | review <id> | approve <id> | reject <id> [--reason] | revert <id> --version N | rm <id> | note <id> "<текст>"
 *   playbook edits <id> | accept <id> <hash> | reject <id> <hash>   правки улучшателя без авто-ревью (`autoReview: false`)
 */
import type {
	CaseDetail,
	CaseDraftResult,
	CaseReadBlock,
	JobView,
	JournalEntry,
	LearningCards,
	LearningSettings,
	LearningView,
	PendingEdit,
	PlaybookDetail,
	PlaybookView,
} from '../../../../shared/types'
import * as fs from 'node:fs'
import { flagBool, flagNum, flagStr } from '../args'
import type { Ctx } from '../ctx'
import { CliError } from '../errors'
import { CASE_FLAGS, LEARN_FLAGS, PLAYBOOK_FLAGS } from '../flags'
import { bold, casesTable, dim, green, jobsTable, journalTable, playbooksTable } from '../format'
import type { CommandTable } from './command.types'

/** Компонент пути (id кейса/плейбука/записи). */
const enc = encodeURIComponent

const LEARN_USAGE = `использование:
  nessy-orch learn [status] | on | off [--session S] | run [--session S]
  nessy-orch learn journal [--limit N] [--revert <id записи>]`
const CASE_USAGE = `использование:
  nessy-orch case ls [--cards] | show <id> | rm <id> | rebuild <id> | note <id> "<текст>"
  nessy-orch case read <id>   следующий блок событий кейса (для агента-сборщика; следующий — только после принятого draft)
  nessy-orch case draft <id> [--file F] [--final] [--from A --key K]   сдать полное описание за блок (иначе stdin); --final — итоговая консолидация после done`
const PLAYBOOK_USAGE = `использование:
  nessy-orch playbook ls [--cards] | show <id> | review <id> | approve <id> | reject <id> [--reason R] | revert <id> --version N | rm <id> | note <id> "<текст>"
  nessy-orch playbook edits <id> | accept <id> <hash> | reject <id> <hash>   правки улучшателя, ждущие решения (авто-ревью выключено)`

function settingsLine(s: LearningSettings): string {
	const off = s.disabledSessions.length ? ` · выключено для: ${s.disabledSessions.join(', ')}` : ''
	return `обучение ${s.enabled ? green('включено') : 'выключено'} · авторевью ${s.autoReview ? 'да' : 'нет'} · сбор раз в ${s.intervalMin} мин · простой ${s.idleMin} мин · агентов ${s.maxAgents}${off}`
}

function printStatus(c: Ctx, v: LearningView): void {
	const { out } = c
	out(settingsLine(v.settings))
	const active = v.jobs.filter(j => j.status !== 'done')
	out(`\n${bold('Очередь')}  ${dim(`активных заданий: ${active.length}, всего в истории: ${v.jobs.length}`)}`)
	if (active.length) out(jobsTable(active))
	out(`\n${bold('Кейсы')}  ${dim(`всего: ${v.cases.length}`)}`)
	out(casesTable(v.cases.slice(0, 10)))
	if (v.cases.length > 10) out(dim(`… ещё ${v.cases.length - 10}: nessy-orch case ls`))
}

function printCase(ctx: Ctx, c: CaseDetail): void {
	const { out } = ctx
	out(`${bold(c.id)}  ${c.status}  ${c.title ?? dim('без заголовка')}`)
	out(dim(`сессии: ${c.sessions.join(', ') || '—'} · события ${c.coveredUntil}/${c.events}`))
	out(dim(`создан ${c.createdAt} · обновлён ${c.updatedAt}${c.closedAt ? ` · закрыт ${c.closedAt}` : ''}`))
	if (c.goals.length) out(dim(`цели: ${c.goals.map(g => `${g.title} (${g.type})`).join('; ')}`))
	out('')
	out(c.summary.trim() ? c.summary.trim() : dim('summary.md пока нет'))
}

async function setEnabled(c: Ctx, enabled: boolean): Promise<void> {
	const { p } = c
	const session = flagStr(p, 'session')
	let body: Partial<LearningSettings>
	if (session === undefined) body = { enabled }
	else {
		const cur = (await c.t.get<LearningView>('/learning')).settings.disabledSessions
		body = { disabledSessions: enabled ? cur.filter(x => x !== session) : [...new Set([...cur, session])] }
	}
	const s = await c.t.patch<LearningSettings>('/learning/settings', body)
	if (flagBool(p, 'json')) return c.json(s)
	c.out(
		`${green('✓')} ${session === undefined ? `обучение ${enabled ? 'включено' : 'выключено'}` : `сессия ${session}: обучение ${enabled ? 'включено' : 'выключено'}`}`,
	)
}

async function cmdLearn(c: Ctx): Promise<void> {
	const { p, out, json } = c
	const [sub = 'status'] = p.positionals
	const asJson = flagBool(p, 'json')
	if (sub === 'status') {
		const v = await c.t.get<LearningView>('/learning')
		return asJson ? json(v) : printStatus(c, v)
	}
	if (sub === 'on' || sub === 'off') return setEnabled(c, sub === 'on')
	if (sub === 'run') {
		const session = flagStr(p, 'session')
		const jobs = await c.t.post<JobView[]>('/learning/run', session === undefined ? {} : { session })
		if (asJson) return json(jobs)
		return out(jobs.length ? `${green('✓')} заданий поставлено: ${jobs.length}\n${jobsTable(jobs)}` : dim('открытых кейсов нет'))
	}
	if (sub === 'journal') {
		const revert = flagStr(p, 'revert')
		if (revert !== undefined) {
			const e = await c.t.post<JournalEntry>(`/learning/journal/${enc(revert)}/revert`, {})
			return asJson ? json(e) : out(`${green('✓')} откат: ${e.summary}`)
		}
		const list = await c.t.get<JournalEntry[]>(`/learning/journal?limit=${flagNum(p, 'limit') ?? 50}`)
		return asJson ? json(list) : out(journalTable(list))
	}
	throw new CliError(`неизвестная подкоманда learn ${sub}\n${LEARN_USAGE}`, 2)
}

function needId(id: string | undefined, sub: string): string {
	if (!id) throw new CliError(`использование: nessy-orch case ${sub} <id>`, 2)
	return id
}

async function cmdCase(c: Ctx): Promise<void> {
	const { p, out, json, info } = c
	const [sub = 'ls', ...rest] = p.positionals
	const asJson = flagBool(p, 'json')
	if (sub === 'ls' && flagBool(p, 'cards')) {
		const cards = await c.t.get<LearningCards>('/learning/cards')
		return asJson ? json(cards.cases) : out(printCards(cards.cases, 'CASE'))
	}
	if (sub === 'ls') {
		const v = await c.t.get<LearningView>('/learning')
		return asJson ? json(v.cases) : out(casesTable(v.cases))
	}
	if (sub === 'show') {
		const d = await c.t.get<CaseDetail>(`/learning/cases/${enc(needId(rest[0], 'show'))}`)
		return asJson ? json(d) : printCase(c, d)
	}
	if (sub === 'rm') {
		const id = needId(rest[0], 'rm')
		await c.t.del(`/learning/cases/${enc(id)}`)
		return asJson ? json({ ok: true }) : out(`${green('✓')} кейс удалён: ${id}`)
	}
	if (sub === 'rebuild') {
		const id = needId(rest[0], 'rebuild')
		const job = await c.t.post<JobView>(`/learning/cases/${enc(id)}/rebuild`, {})
		return asJson ? json(job) : out(`${green('✓')} пересборка кейса ${id}: задание ${job.id}`)
	}
	if (sub === 'note') {
		const id = needId(rest[0], 'note')
		await c.t.put(`/learning/cases/${enc(id)}/notes`, { text: rest.slice(1).join(' ') })
		return asJson ? json({ ok: true }) : out(`${green('✓')} заметки кейса ${id} записаны`)
	}
	if (sub === 'read') {
		const id = needId(rest[0], 'read')
		// 409 `summary_required` — исключение: текст протокола в stderr целиком, код 1
		const b = await c.t.get<CaseReadBlock>(`/learning/cases/${enc(id)}/read`)
		if (asJson) return json(b)
		if (b.done) {
			info(`done\n${b.card}`)
			return
		}
		out(`${b.header}\n\n${b.text}\n\n${b.card}`)
		info(`block n ${b.from}–${b.until} issued, ${b.remaining} events remain after it`)
		return
	}
	if (sub === 'draft') {
		const id = needId(rest[0], 'draft')
		const file = flagStr(p, 'file')
		let text: string
		try {
			text = fs.readFileSync(file ?? 0, 'utf8')
		} catch (e) {
			throw new CliError(`не удалось прочитать ${file ?? 'stdin'}: ${e instanceof Error ? e.message : String(e)}`, 2)
		}
		const from = flagStr(p, 'from')
		const final = flagBool(p, 'final')
		// отказ (422 `rejected`) — исключение: список нарушений в stderr целиком, код 1
		const r = await c.t.post<CaseDraftResult>(`/learning/cases/${enc(id)}/draft${final ? '?final=1' : ''}`, from === undefined ? { text } : { text, from })
		if (asJson) return json(r)
		info(r.message)
		return
	}
	throw new CliError(`неизвестная подкоманда case ${sub}\n${CASE_USAGE}`, 2)
}

/** Карточки одним текстом: `CASE <id>` / `PLAYBOOK <id>` и сама карточка. */
function printCards(list: ReadonlyArray<{ id: string; card: string }>, label: string): string {
	return list.length ? list.map(x => `${label} ${x.id}\n${x.card}`).join('\n\n') : dim('карточек нет')
}

/** Правка по хэшу или его началу (от 4 знаков); неоднозначное или неизвестное — ошибка с кодом 2. */
export function resolveEdit(edits: readonly PendingEdit[], hash: string): PendingEdit {
	const found = hash.length >= 4 ? edits.filter(e => e.hash.startsWith(hash)) : []
	const [only] = found
	if (found.length === 1 && only) return only
	throw new CliError(
		found.length ? `хэш ${hash} подходит к нескольким правкам, укажите длиннее` : `нет ждущей правки ${hash}: см. nessy-orch playbook edits <id>`,
		2,
	)
}

function printEdits(out: (s: string) => void, id: string, edits: readonly PendingEdit[]): void {
	if (!edits.length) return out(dim(`у плейбука ${id} нет правок, ждущих решения`))
	for (const e of edits) {
		out(`${bold(e.hash.slice(0, 12))}  ${e.file}  (кейс ${e.caseId}, ${e.anchor})`)
		out(`  - ${e.before.replace(/\n/g, '\n    ')}`)
		out(`  + ${e.after.replace(/\n/g, '\n    ')}`)
	}
}

async function cmdPlaybook(c: Ctx): Promise<void> {
	const { p, out, json } = c
	const [sub = 'ls', ...rest] = p.positionals
	const asJson = flagBool(p, 'json')
	if (sub === 'ls' && flagBool(p, 'cards')) {
		const cards = await c.t.get<LearningCards>('/learning/cards')
		return asJson ? json(cards.playbooks) : out(printCards(cards.playbooks, 'PLAYBOOK'))
	}
	if (sub === 'ls') {
		const list = await c.t.get<PlaybookView[]>('/learning/playbooks')
		return asJson ? json(list) : out(playbooksTable(list))
	}
	const need = (): string => {
		const id = rest[0]
		if (!id) throw new CliError(`использование: nessy-orch playbook ${sub} <id>\n${PLAYBOOK_USAGE}`, 2)
		return enc(id)
	}
	if (sub === 'show') {
		const d = await c.t.get<PlaybookDetail>(`/learning/playbooks/${need()}`)
		return asJson ? json(d) : out(d.markdown)
	}
	if (sub === 'review') {
		const job = await c.t.post<JobView>(`/learning/playbooks/${need()}/review`, {})
		return asJson ? json(job) : out(`${green('✓')} ревью поставлено: задание ${job.id}`)
	}
	if (sub === 'approve') {
		const v = await c.t.post<PlaybookView>(`/learning/playbooks/${need()}/approve`, {})
		return asJson ? json(v) : out(`${green('✓')} ${v.id}: ${v.status}`)
	}
	if (sub === 'reject' && rest[1] === undefined) {
		const v = await c.t.post<PlaybookView>(`/learning/playbooks/${need()}/reject`, { reason: flagStr(p, 'reason') ?? '' })
		return asJson ? json(v) : out(`${green('✓')} ${v.id}: ${v.status}`)
	}
	if (sub === 'revert') {
		const version = flagNum(p, 'version')
		if (version === undefined) throw new CliError(`нужен --version N\n${PLAYBOOK_USAGE}`, 2)
		const v = await c.t.post<PlaybookView>(`/learning/playbooks/${need()}/revert`, { version })
		return asJson ? json(v) : out(`${green('✓')} ${v.id}: откат к версии ${version}, теперь v${v.version}`)
	}
	if (sub === 'rm') {
		const id = need()
		await c.t.del(`/learning/playbooks/${id}`)
		return asJson ? json({ ok: true }) : out(`${green('✓')} плейбук удалён: ${decodeURIComponent(id)}`)
	}
	if (sub === 'note') {
		const id = need()
		await c.t.put(`/learning/playbooks/${id}/notes`, { text: rest.slice(1).join(' ') })
		return asJson ? json({ ok: true }) : out(`${green('✓')} заметки плейбука записаны`)
	}
	if (sub === 'edits') {
		const d = await c.t.get<PlaybookDetail>(`/learning/playbooks/${need()}`)
		const edits = d.pendingEdits ?? []
		return asJson ? json(edits) : printEdits(out, d.id, edits)
	}
	if (sub === 'accept' || sub === 'reject') {
		// `reject <id> <hash>` — правка улучшателя (без хэша `reject <id>` отклоняет весь плейбук)
		const id = need()
		const hash = rest[1]
		if (!hash) throw new CliError(`использование: nessy-orch playbook ${sub} <id> <hash>\n${PLAYBOOK_USAGE}`, 2)
		const e = resolveEdit((await c.t.get<PlaybookDetail>(`/learning/playbooks/${id}`)).pendingEdits ?? [], hash)
		const v = await c.t.post<PlaybookView>(`/learning/playbooks/${id}/edits/${enc(e.hash)}/${sub}`, {})
		return asJson ? json(v) : out(`${green('✓')} ${v.id}: правка ${e.hash.slice(0, 12)} ${sub === 'accept' ? 'принята' : 'отклонена'}, теперь v${v.version}`)
	}
	throw new CliError(`неизвестная подкоманда playbook ${sub}\n${PLAYBOOK_USAGE}`, 2)
}

export const learningCommands: CommandTable = {
	learn: { run: cmdLearn, spec: LEARN_FLAGS },
	case: { run: cmdCase, spec: CASE_FLAGS },
	cases: { run: cmdCase, spec: CASE_FLAGS },
	playbook: { run: cmdPlaybook, spec: PLAYBOOK_FLAGS },
}
