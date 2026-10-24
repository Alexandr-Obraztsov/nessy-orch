/**
 * Команды сессий: session new|ls|show|sources|done|reopen|rm.
 * Семантика — как у текущего CLI, вывод — современный (цвета, компактные статусы).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AgentView, GraphView, SessionPatch, SessionRequest, SessionView, SourceView } from '../../../../shared/types'
import { flagBool, flagStr } from '../args'
import { bold, dim, green, sessionAgentsTable, sessionsTable, status as statusColor } from '../format'
import { CliError } from '../errors'
import type { Ctx } from '../ctx'
import { SESSION_FLAGS } from '../flags'
import type { CommandTable } from './command.types'

const USAGE = `использование:
  nessy-orch session new "<заголовок>" [--owner X] [--id slug]
  nessy-orch session ls [--all] | session show <id> | session sources <id> | session rm <id>
  nessy-orch session done <id> [--summary "…" | --summary-file F] | session reopen <id>`

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

/** Итог сессии из --summary или --summary-file. */
function readSummary(c: Ctx): string | undefined {
	const inline = flagStr(c.p, 'summary')
	const file = flagStr(c.p, 'summary-file')
	if (inline !== undefined && file !== undefined) throw new CliError('укажите либо --summary, либо --summary-file', 2)
	if (file === undefined) return inline
	try {
		return fs.readFileSync(path.resolve(c.cwd, file), 'utf8')
	} catch (e) {
		throw new CliError(`не удалось прочитать ${file}: ${e instanceof Error ? e.message : String(e)}`, 2)
	}
}

function printSession(c: Ctx, t: SessionView, agents: readonly AgentView[]): void {
	c.out(`${bold(t.id)}  ${statusColor(t.status)}  ${t.title}`)
	c.out(dim(`владелец: ${t.owner ?? '—'} · создана ${t.createdAt} · обновлена ${t.updatedAt}`))
	c.out(dim(`источников: ${t.sources} · ${statsLine(agents)}`))
	c.out('')
	c.out(sessionAgentsTable(agents))
	if (t.summary) c.out(`\n${bold('Итог')}\n${t.summary}`)
}

async function cmdSession(c: Ctx): Promise<void> {
	const { p, t } = c
	const [sub, ...rest] = p.positionals
	const asJson = flagBool(p, 'json')
	if (sub === 'new') {
		const title = rest.join(' ').trim()
		if (!title) throw new CliError('использование: nessy-orch session new "<заголовок>" [--owner X] [--id slug]', 2)
		const owner = flagStr(p, 'owner')
		const id = flagStr(p, 'id')
		const body: SessionRequest = { title, ...(owner !== undefined ? { owner } : {}), ...(id !== undefined ? { id } : {}) }
		const s = await t.post<SessionView>('/sessions', body)
		if (asJson) return c.json(s)
		c.out(s.id)
		c.out(`nessy-orch://session/${encodeURIComponent(s.id)}`)
		return c.info(dim(`сессия заведена один раз на весь разговор. Агенты: nessy-orch spawn --session ${s.id} …`))
	}
	if (sub === 'ls' || sub === undefined) {
		const g = await t.get<GraphView>('/graph')
		const all = flagBool(p, 'all')
		const list = all ? g.sessions : g.sessions.filter(s => s.status === 'active')
		return asJson ? c.json(list) : c.out(sessionsTable(list, g.agents, g.sessions.length - list.length))
	}
	if (sub === 'show') {
		const id = needId(rest[0], 'show')
		const [s, agents] = await Promise.all([
			t.get<SessionView>(`/sessions/${encodeURIComponent(id)}`),
			t.get<AgentView[]>(`/agents?session=${encodeURIComponent(id)}`),
		])
		return asJson ? c.json({ session: s, agents }) : printSession(c, s, agents)
	}
	if (sub === 'sources') {
		const id = needId(rest[0], 'sources')
		const list = await t.get<SourceView[]>(`/sessions/${encodeURIComponent(id)}/sources`)
		if (asJson) return c.json(list)
		if (!list.length) return c.out(dim('источников пока нет'))
		for (const x of list)
			c.out(`${x.kind === 'url' ? (x.href ?? x.label) : x.label}  ${dim(`${x.agentName} · ${x.origin === 'reply' ? 'ответ' : 'инструмент'}`)}`)
		return
	}
	if (sub === 'done' || sub === 'reopen') {
		const id = needId(rest[0], sub)
		const body: SessionPatch = { status: sub === 'done' ? 'done' : 'active' }
		const summary = readSummary(c)
		if (summary !== undefined) body.summary = summary
		const s = await t.patch<SessionView>(`/sessions/${encodeURIComponent(id)}`, body)
		return asJson ? c.json(s) : c.out(`${green('✓')} сессия ${bold(s.id)}: ${sub === 'done' ? 'завершена' : 'снова активна'}`)
	}
	if (sub === 'rm') {
		const id = needId(rest[0], 'rm')
		await t.del(`/sessions/${encodeURIComponent(id)}`)
		return c.out(`${green('✓')} сессия удалена: ${id} (её агенты остались вне сессий)`)
	}
	throw new CliError(`неизвестная подкоманда session ${sub}\n${USAGE}`, 2)
}

export const sessionCommands: CommandTable = {
	session: { run: cmdSession, spec: SESSION_FLAGS },
}
