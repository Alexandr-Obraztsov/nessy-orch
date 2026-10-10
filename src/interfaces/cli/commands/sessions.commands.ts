/**
 * Команды сессий: session new|ls|show|sources|done|reopen|rm. Сессия — одна работа одного оркестратора (Claude):
 * Claude заводит её один раз в начале, все его агенты запускаются в ней (spawn --session), ответы читаются из её
 * inbox (inbox --session) — так несколько Claude работают параллельно и не забирают ответы друг друга.
 * В сессии копятся источники (ссылки из ответов и инструментов) и счётчики (ходы, инструменты, токены).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AgentView, GraphView, SessionPatch, SessionRequest, SessionView, SourceView } from '../../../../shared/types'
import { errMsg } from '../../../lib/json'
import { flagBool, flagStr } from '../args'
import type { FlagSpec, Parsed } from '../args.types'
import type { Endpoint } from '../client.types'
import { CliError } from '../errors'
import { bold, dim, green, status, sessionAgentsTable, sessionsTable } from '../format'
import { del, enc, ep, get, info, json, out, patch, post } from '../io'
import type { CommandTable } from './command.types'

/** Переменная окружения со значением --session по умолчанию (одна сессия на сессию Claude). */
export const SESSION_ENV = 'NESSY_ORCH_SESSION'

export const SESSION_FLAGS: FlagSpec = { bool: ['json', 'help', 'all'], value: ['owner', 'id', 'summary', 'summary-file'], short: { a: 'all' } }

const USAGE = `использование:
  nessy-orch session new "<заголовок>" [--owner X] [--id slug]
  nessy-orch session ls [--all] | session show <id> | session sources <id> | session rm <id>
  nessy-orch session done <id> [--summary "…" | --summary-file F] | session reopen <id>`

/** Значение --session: флаг, иначе NESSY_ORCH_SESSION; пусто — без сессии. */
export function sessionOption(p: Parsed, env: NodeJS.ProcessEnv = process.env): string | undefined {
	const v = flagStr(p, 'session') ?? env[SESSION_ENV]
	const t = v?.trim()
	return t ? t : undefined
}

/** Ссылка на сессию для приложения Nessy Orch (открывается командой `open <ссылка>` или кликом). */
export function sessionUrl(_e: Endpoint, id: string): string {
	return `nessy-orch://session/${encodeURIComponent(id)}`
}

/** Итог сессии из --summary или --summary-file (undefined — не задан). */
export function readSummary(p: Parsed): string | undefined {
	const inline = flagStr(p, 'summary')
	const file = flagStr(p, 'summary-file')
	if (inline !== undefined && file !== undefined) throw new CliError('укажите либо --summary, либо --summary-file', 2)
	if (file === undefined) return inline
	try {
		return fs.readFileSync(path.resolve(file), 'utf8')
	} catch (e) {
		throw new CliError(`не удалось прочитать ${file}: ${errMsg(e)}`, 2)
	}
}

/** Сводка работы агентов сессии: ходы, инструменты, время, токены. */
export function statsLine(agents: readonly AgentView[]): string {
	const turns = agents.reduce((n, a) => n + a.stats.turns, 0)
	const tools = agents.reduce((n, a) => n + a.stats.toolCalls, 0)
	const ms = agents.reduce((n, a) => n + a.stats.workMs, 0)
	const tokens = agents.reduce((n, a) => n + (a.stats.tokens?.total ?? 0), 0)
	const parts = [`ходов ${turns}`, `инструментов ${tools}`, `работа ${Math.round(ms / 1000)} с`]
	parts.push(tokens > 0 ? `токенов ${tokens.toLocaleString('ru-RU')}` : 'токены не сообщены')
	return parts.join(' · ')
}

function needId(id: string | undefined, sub: string): string {
	if (!id) throw new CliError(`использование: nessy-orch session ${sub} <id>`, 2)
	return id
}

function printSession(t: SessionView, agents: readonly AgentView[]): void {
	out(`${bold(t.id)}  ${status(t.status)}  ${t.title}`)
	out(dim(`владелец: ${t.owner ?? '—'} · создана ${t.createdAt} · обновлена ${t.updatedAt}`))
	out(dim(`приложение: ${sessionUrl(ep, t.id)}`))
	out(dim(`источников: ${t.sources} · ${statsLine(agents)}`))
	out('')
	out(sessionAgentsTable(agents))
	if (t.summary) out(`\n${bold('Итог')}\n${t.summary}`)
}

async function cmdSession(p: Parsed): Promise<void> {
	const [sub, ...rest] = p.positionals
	const asJson = flagBool(p, 'json')
	if (sub === 'new') {
		const title = rest.join(' ').trim()
		if (!title) throw new CliError('использование: nessy-orch session new "<заголовок>" [--owner X] [--id slug]', 2)
		const body: SessionRequest = { title, owner: flagStr(p, 'owner'), id: flagStr(p, 'id') }
		const t = await post<SessionView>('/sessions', body)
		if (asJson) return json({ ...t, url: sessionUrl(ep, t.id) })
		out(t.id)
		out(sessionUrl(ep, t.id))
		return info(dim(`сессия заведена один раз на весь разговор. Агенты: nessy-orch spawn --session ${t.id} …; ответы: nessy-orch inbox --session ${t.id} --wait 1500`))
	}
	if (sub === 'ls' || sub === undefined) {
		const g = await get<GraphView>('/graph')
		const all = flagBool(p, 'all')
		const list = all ? g.sessions : g.sessions.filter(t => t.status === 'active')
		return asJson ? json(list) : out(sessionsTable(list, g.agents, g.sessions.length - list.length))
	}
	if (sub === 'show') {
		const id = needId(rest[0], 'show')
		const [t, agents] = await Promise.all([get<SessionView>(`/sessions/${enc(id)}`), get<AgentView[]>(`/agents?session=${enc(id)}`)])
		return asJson ? json({ session: t, agents }) : printSession(t, agents)
	}
	if (sub === 'sources') {
		const id = needId(rest[0], 'sources')
		const list = await get<SourceView[]>(`/sessions/${enc(id)}/sources`)
		if (asJson) return json(list)
		if (!list.length) return out(dim('источников пока нет'))
		for (const x of list) out(`${x.kind === 'url' ? (x.href ?? x.label) : x.label}  ${dim(`${x.agentName} · ${x.origin === 'reply' ? 'ответ' : 'инструмент'}`)}`)
		return
	}
	if (sub === 'done' || sub === 'reopen') {
		const id = needId(rest[0], sub)
		const body: SessionPatch = { status: sub === 'done' ? 'done' : 'active' }
		const summary = readSummary(p)
		if (summary !== undefined) body.summary = summary
		const t = await patch<SessionView>(`/sessions/${enc(id)}`, body)
		return asJson ? json(t) : out(`${green('✓')} сессия ${bold(t.id)}: ${sub === 'done' ? 'завершена' : 'снова активна'}`)
	}
	if (sub === 'rm') {
		const id = needId(rest[0], 'rm')
		await del(`/sessions/${enc(id)}`)
		return out(`${green('✓')} сессия удалена: ${id} (её агенты остались вне сессий)`)
	}
	throw new CliError(`неизвестная подкоманда session ${sub}\n${USAGE}`, 2)
}

export const sessionCommands: CommandTable = {
	session: { run: cmdSession, spec: SESSION_FLAGS },
}
