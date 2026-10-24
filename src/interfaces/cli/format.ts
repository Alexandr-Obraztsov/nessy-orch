/** Форматирование вывода CLI (для человека; для машин есть --json): цвета, таблицы, статусы, план. */
import type { AgentPlan, AgentView, CaseView, JobView, JournalEntry, Message, PlaybookView, SessionView } from '../../../shared/types'
import { formatPlanLine } from '../../domain/plan'

const tty = process.stdout.isTTY && !process.env['NO_COLOR']
const c =
	(code: string) =>
	(s: string): string =>
		tty ? `\x1b[${code}m${s}\x1b[0m` : s
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
	const line = (r: string[]): string =>
		r
			.map((cell, i) => cell + ' '.repeat((widths[i] ?? 0) - stripAnsi(cell).length))
			.join('  ')
			.trimEnd()
	return [...(header ? [dim(line(header))] : []), ...rows.map(line)].join('\n')
}

// eslint-disable-next-line no-control-regex -- \x1b (ESC) — служебный ANSI-код, без него stripAnsi не отрежет управляющие последовательности
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

/** План чек-листом: [x] сделано, [~] в работе, [ ] впереди. */
export function planText(plan: AgentPlan): string {
	const done = plan.entries.filter(e => e.status === 'completed').length
	const head = dim(`план ${done}/${plan.entries.length} · ${plan.source} · ${plan.updatedAt}`)
	return [
		head,
		...plan.entries.map(e => (e.status === 'in_progress' ? yellow(formatPlanLine(e)) : e.status === 'completed' ? dim(formatPlanLine(e)) : formatPlanLine(e))),
	].join('\n')
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

/** Цветной маркер статуса агента/сессии: ● работает, ○ свободен, ✖ ошибка. */
export function statusDot(s: string): string {
	switch (s) {
		case 'working':
		case 'starting':
		case 'active':
			return status('●')
		case 'idle':
		case 'ready':
		case 'done':
			return status('○')
		case 'error':
		case 'failed':
		case 'stopped':
			return status('✖')
		default:
			return '○'
	}
}

/** «рантайм · модель» агента; если рантайм подставил не ту модель — пометка «запрошено X»; нет полей — прочерк. */
export function runtimeModelCell(a: AgentView): string {
	const parts: string[] = []
	if (a.runtime) parts.push(a.runtime)
	if (a.model) parts.push(a.model)
	if (a.modelRequested) parts.push(yellow(`запрошено ${a.modelRequested}`))
	return parts.length ? dim(parts.join(' · ')) : dim('—')
}

/** «рантайм · модель» роли: что не задано — прочерк (пространство/дефолт рантайма). */
export function roleModelCell(r: { model?: string | null; runtime?: string | null }): string {
	return dim(`${r.runtime ?? '—'} · ${r.model ?? '—'}`)
}

/** Заполнение окна контекста (%): от 60% красим красным. */
export function contextCell(a: AgentView): string {
	const pct = a.stats.contextPct
	if (pct === null || pct === undefined) return dim('—')
	return pct >= 60 ? red(String(pct)) + '%' : `${pct}%`
}

/** Компактная строка «id имя «заголовок» — статус — очередь» для дерева (агента находят и по имени, и по заголовку, и по id). */
export function agentCell(a: AgentView): string {
	const busy = a.queued ? dim(` +${a.queued}`) : ''
	const archived = a.archived ? dim(' · архив') : ''
	const title = a.title ? dim(` «${a.title}»`) : ''
	const name = a.name && a.name !== a.id ? dim(` ${a.name}`) : ''
	return `${bold(a.id)}${name}${title} ${statusDot(a.status)}${busy}${archived}`
}

const when = (iso: string): string => dim(iso.slice(0, 16).replace('T', ' '))

/** Кейсы обучения. */
export function casesTable(cases: readonly CaseView[]): string {
	if (!cases.length) return dim('кейсов пока нет')
	return table(
		cases.map(c => [bold(c.id), status(c.status), `${c.coveredUntil}/${c.events}`, (c.title ?? '—').slice(0, 60), when(c.updatedAt)]),
		['ID', 'СТАТУС', 'СОБЫТИЯ', 'ЗАГОЛОВОК', 'ОБНОВЛЁН'],
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

/** Плейбуки обучения. */
export function playbooksTable(list: readonly PlaybookView[]): string {
	if (!list.length) return dim('плейбуков пока нет')
	return table(
		list.map(p => [
			bold(p.id),
			status(p.status),
			`v${p.version}`,
			String(p.cases.length),
			`${p.rules.filter(r => r.status === 'active').length}/${p.rules.length}`,
			p.title.slice(0, 50),
			when(p.updatedAt),
		]),
		['ID', 'СТАТУС', 'ВЕРСИЯ', 'КЕЙСОВ', 'ПРАВИЛ', 'НАЗВАНИЕ', 'ОБНОВЛЁН'],
	)
}

/** Журнал автоматических решений. */
export function journalTable(list: readonly JournalEntry[]): string {
	if (!list.length) return dim('журнал пуст')
	return table(
		list.map(e => [
			bold(e.id),
			when(e.ts),
			e.kind,
			e.revertedBy ? dim(`${e.summary.slice(0, 70)} (откачено)`) : e.summary.slice(0, 80),
			e.revertible && !e.revertedBy ? 'да' : '',
		]),
		['ID', 'КОГДА', 'ВИД', 'РЕШЕНИЕ', 'ОТКАТ'],
	)
}
