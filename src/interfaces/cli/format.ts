/** Форматирование вывода CLI (для человека; для машин есть --json). */
import type { AgentView, Message, SpaceView } from '../../../shared/types'

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
	dead: red,
	starting: blue,
	sleeping: dim,
	ready: green,
	failed: red,
	stopped: dim,
}
export const status = (s: string): string => (STATUS_COLOR[s] ?? ((x: string) => x))(s)

export function pad(s: string, n: number): string {
	return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

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

export function agentsTable(agents: readonly AgentView[], spaces: readonly SpaceView[]): string {
	if (!agents.length) return dim('агентов нет. Создайте: nessy-orch spawn --space <путь> "задача"')
	const sp = new Map(spaces.map(s => [s.name, s]))
	return table(
		agents.map(a => [
			bold(a.id),
			a.name === a.id ? dim('—') : a.name,
			status(a.status) + (a.queued ? dim(` +${a.queued}`) : ''),
			a.space + (sp.get(a.space)?.status === 'failed' ? red(' (!)') : ''),
			a.lastTool ? dim(`⚙ ${a.lastTool.name}`) : a.preview ? dim(a.preview.replace(/\s+/g, ' ').slice(0, 50)) : '',
		]),
		['ID', 'ИМЯ', 'СТАТУС', 'ПРОСТРАНСТВО', 'ПОСЛЕДНЕЕ'],
	)
}

export function spacesTable(spaces: readonly SpaceView[]): string {
	if (!spaces.length) return dim('пространств нет. Добавьте: nessy-orch space add <путь>')
	return table(
		spaces.map(s => [bold(s.name), status(s.status), s.mode, s.path, s.error ? red(s.error.slice(0, 60)) : '']),
		['ИМЯ', 'СТАТУС', 'РЕЖИМ', 'ПУТЬ', 'ОШИБКА'],
	)
}
