/** Форматирование вывода CLI (для человека; для машин есть --json). */
import type { AgentPlan, AgentView, BackfillCandidate, CaseView, JobView, Message, RoleView, SpaceView, SessionView } from '../../../shared/types'
import { formatPlanLine } from '../../domain/plan'

const tty = process.stdout.isTTY && !process.env['NO_COLOR']
const c = (code: string) => (s: string): string => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
export const dim = c('90')
export const red = c('31')
export const green = c('32')
export const yellow = c('33')
export const blue = c('34')
export const bold = c('1')

export function time(ts: number): string {
	return new Date(ts).toTimeString().slice(0, 8)
}

const STATUS_COLOR: Record<string, (s: string) => string> = {
	idle: green,
	working: yellow,
	error: red,
	starting: blue,
	ready: green,
	failed: red,
	stopped: dim,
	active: yellow,
	done: green,
	collecting: yellow,
	closing: yellow,
	running: yellow,
	queued: dim,
}
export const status = (s: string): string => (STATUS_COLOR[s] ?? ((x: string) => x))(s)

export function table(rows: string[][], header?: string[]): string {
	const all = header ? [header, ...rows] : rows
	const widths: number[] = []
	for (const r of all) r.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, stripAnsi(cell).length)))
	const line = (r: string[]): string => r.map((cell, i) => cell + ' '.repeat((widths[i] ?? 0) - stripAnsi(cell).length)).join('  ').trimEnd()
	return [...(header ? [dim(line(header))] : []), ...rows.map(line)].join('\n')
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')

export function agentLabel(id: string, agents: ReadonlyMap<string, AgentView>): string {
	if (id === 'you' || id === 'system') return id
	const a = agents.get(id)
	return a ? a.name : id
}

export function formatMessage(m: Message, agents: ReadonlyMap<string, AgentView>): string {
	if (m.kind === 'event') return dim(`${time(m.ts)} · ${m.text}`)
	const head = `${dim(time(m.ts))} ${bold(agentLabel(m.from, agents))} ${dim('→')} ${bold(agentLabel(m.to, agents))}${m.kind === 'reply' ? dim(' (ответ)') : ''}${m.failed ? red(' [ошибка]') : ''}`
	const body = m.text
		.split('\n')
		.map(l => '  ' + l)
		.join('\n')
	return `${head}\n${body}`
}

function roleCell(id: string | null, roles: ReadonlyMap<string, RoleView>): string {
	if (id === null) return dim('—')
	return roles.has(id) ? id : dim(`${id} (удалена)`)
}

/** Таблица агентов; hiddenArchived — сколько архивных скрыто (подсказка про --all). */
/** Заполнение окна контекста агента: от 60% красим — новую задачу такому агенту лучше не давать. */
function contextCell(a: AgentView): string {
	const pct = a.stats.contextPct
	if (pct === null || pct === undefined) return dim('—')
	return pct >= 60 ? red(`${pct}%`) : `${pct}%`
}

export function agentsTable(agents: readonly AgentView[], spaces: readonly SpaceView[], roles: readonly RoleView[] = [], hiddenArchived = 0): string {
	const hint = hiddenArchived ? dim(`в архиве: ${hiddenArchived} (показать: nessy-orch ls --all)`) : ''
	if (!agents.length) return [dim('активных агентов нет. Создайте: nessy-orch spawn --session <id> "поручение"'), hint].filter(Boolean).join('\n')
	const sp = new Map(spaces.map(s => [s.name, s]))
	const rl = new Map(roles.map(r => [r.id, r]))
	const rows = table(
		agents.map(a => [
			bold(a.id),
			a.name === a.id ? dim('—') : a.name,
			a.title ?? dim('—'),
			roleCell(a.role, rl),
			status(a.status) + (a.archived ? dim(' · архив') : '') + (a.queued ? dim(` +${a.queued}`) : ''),
			a.space + (sp.get(a.space)?.status === 'failed' ? red(' (!)') : ''),
			contextCell(a),
			a.lastTool ? dim(`⚙ ${a.lastTool.name}`) : a.preview ? dim(a.preview.replace(/\s+/g, ' ').slice(0, 50)) : '',
		]),
		['ID', 'ИМЯ', 'ЗАГОЛОВОК', 'РОЛЬ', 'СТАТУС', 'ПРОСТРАНСТВО', 'КОНТЕКСТ', 'ПОСЛЕДНЕЕ'],
	)
	return hint ? `${rows}\n${hint}` : rows
}

export function rolesTable(roles: readonly RoleView[]): string {
	if (!roles.length) return dim('ролей нет. Добавьте: nessy-orch role add <имя> --instructions "…"')
	return table(
		roles.map(r => [bold(r.id), r.name, dim(`${r.color}°${r.icon ? ` ${r.icon}` : ''}`), dim(r.description.slice(0, 60)), dim(`${r.instructions.length} симв.`)]),
		['ID', 'ИМЯ', 'ЦВЕТ', 'ОПИСАНИЕ', 'ИНСТРУКЦИИ'],
	)
}

export function spacesTable(spaces: readonly SpaceView[]): string {
	if (!spaces.length) return dim('пространств нет. Добавьте: nessy-orch space add <путь>')
	return table(
		spaces.map(s => [bold(s.name), status(s.status), s.mode, s.path, s.error ? red(s.error.slice(0, 60)) : '']),
		['ИМЯ', 'СТАТУС', 'РЕЖИМ', 'ПУТЬ', 'ОШИБКА'],
	)
}

/** План чек-листом: [x] сделано, [~] в работе, [ ] впереди. */
export function planText(plan: AgentPlan): string {
	const done = plan.entries.filter(e => e.status === 'completed').length
	const head = dim(`план ${done}/${plan.entries.length} · ${plan.source} · ${plan.updatedAt}`)
	return [head, ...plan.entries.map(e => (e.status === 'in_progress' ? yellow(formatPlanLine(e)) : e.status === 'completed' ? dim(formatPlanLine(e)) : formatPlanLine(e)))].join('\n')
}

/** Прогресс плана `x/y` (пусто, если плана нет). */
export function planProgress(plan: AgentPlan | null): string {
	if (!plan?.entries.length) return ''
	return `${plan.entries.filter(e => e.status === 'completed').length}/${plan.entries.length}`
}

/** Таблица сессий; agents — все агенты (для счётчика «работают/всего»). */
export function sessionsTable(sessions: readonly SessionView[], agents: readonly AgentView[], hiddenDone = 0): string {
	const hint = hiddenDone ? dim(`завершённых: ${hiddenDone} (показать: nessy-orch session ls --all)`) : ''
	if (!sessions.length) return [dim('активных сессий нет. Заведите: nessy-orch session new "<цель>" --owner lead'), hint].filter(Boolean).join('\n')
	const rows = table(
		sessions.map(t => {
			const mine = agents.filter(a => a.session === t.id)
			const working = mine.filter(a => a.status === 'working').length
			return [
				bold(t.id),
				status(t.status),
				t.owner ?? dim('—'),
				`${mine.length}${working ? yellow(` (${working} работ.)`) : ''}`,
				t.title.slice(0, 60),
				dim(t.updatedAt.slice(0, 16).replace('T', ' ')),
			]
		}),
		['ID', 'СТАТУС', 'ВЛАДЕЛЕЦ', 'АГЕНТЫ', 'ЗАГОЛОВОК', 'ОБНОВЛЕНА'],
	)
	return hint ? `${rows}\n${hint}` : rows
}

/** Агенты сессии: статус и прогресс плана x/y. */
export function sessionAgentsTable(agents: readonly AgentView[]): string {
	if (!agents.length) return dim('агентов в сессии нет')
	return table(
		agents.map(a => [
			bold(a.id),
			a.name === a.id ? dim('—') : a.name,
			a.role ?? dim('—'),
			status(a.status) + (a.archived ? dim(' · архив') : '') + (a.pendingPermissions.length ? yellow(' · ждёт разрешения') : ''),
			planProgress(a.plan) || dim('—'),
			a.lastTool ? dim(`⚙ ${a.lastTool.name}`) : a.preview ? dim(a.preview.replace(/\s+/g, ' ').slice(0, 50)) : '',
		]),
		['ID', 'ИМЯ', 'РОЛЬ', 'СТАТУС', 'ПЛАН', 'ПОСЛЕДНЕЕ'],
	)
}

const when = (iso: string): string => dim(iso.slice(0, 16).replace('T', ' '))

/** Кейсы обучения. */
export function casesTable(cases: readonly CaseView[]): string {
	if (!cases.length) return dim('кейсов пока нет')
	return table(
		cases.map(c => [bold(c.id), status(c.status), c.source === 'backfill' ? 'разбор' : 'живой', `${c.coveredUntil}/${c.events}`, (c.title ?? '—').slice(0, 60), when(c.updatedAt)]),
		['ID', 'СТАТУС', 'ОТКУДА', 'СОБЫТИЯ', 'ЗАГОЛОВОК', 'ОБНОВЛЁН'],
	)
}

/** Задания обучения. */
export function jobsTable(jobs: readonly JobView[]): string {
	if (!jobs.length) return dim('заданий нет')
	return table(
		jobs.map(j => [bold(j.id), j.kind, status(j.status), j.caseId, String(j.attempts), j.error ? red(j.error.slice(0, 60)) : (j.note ?? '')]),
		['ID', 'ВИД', 'СТАТУС', 'КЕЙС', 'ПОПЫТОК', 'ЗАМЕТКА'],
	)
}

const kb = (n: number): string => (n >= 1024 ? `${Math.round(n / 1024)} КБ` : `${n} Б`)

/** Кандидаты разбора прошлых сессий (размер: сессия — сообщений, транскрипт — байты). */
export function candidatesTable(list: readonly BackfillCandidate[]): string {
	if (!list.length) return dim('разбирать нечего')
	return table(
		list.map(x => [bold(x.id), x.kind === 'session' ? 'сессия' : 'транскрипт', when(x.date), x.kind === 'session' ? `${x.size} сообщ.` : kb(x.size), x.title.slice(0, 60)]),
		['ID', 'ВИД', 'ДАТА', 'РАЗМЕР', 'ЗАГОЛОВОК'],
	)
}
