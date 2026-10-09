/**
 * Команды задач: task new|ls|show|done|reopen|rm. Задача («ящик») — работа одного оркестратора (Claude):
 * агенты запускаются в ней (spawn --task), ответы читаются из её inbox (inbox --task) — так несколько
 * Claude работают параллельно и не забирают ответы друг друга.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AgentView, GraphView, TaskPatch, TaskRequest, TaskView } from '../../../../shared/types'
import { errMsg } from '../../../lib/json'
import { flagBool, flagStr } from '../args'
import type { FlagSpec, Parsed } from '../args.types'
import type { Endpoint } from '../client.types'
import { CliError } from '../errors'
import { bold, dim, green, status, taskAgentsTable, tasksTable } from '../format'
import { del, enc, ep, get, info, json, out, patch, post } from '../io'
import type { CommandTable } from './command.types'

/** Переменная окружения со значением --task по умолчанию (одна задача на сессию Claude). */
export const TASK_ENV = 'NESSY_ORCH_TASK'

export const TASK_FLAGS: FlagSpec = { bool: ['json', 'help', 'all'], value: ['owner', 'id', 'summary', 'summary-file'], short: { a: 'all' } }

const USAGE = `использование:
  nessy-orch task new "<заголовок>" [--owner X] [--id slug]
  nessy-orch task ls [--all] | task show <id> | task rm <id>
  nessy-orch task done <id> [--summary "…" | --summary-file F] | task reopen <id>`

/** Значение --task: флаг, иначе NESSY_ORCH_TASK; пусто — без задачи. */
export function taskOption(p: Parsed, env: NodeJS.ProcessEnv = process.env): string | undefined {
	const v = flagStr(p, 'task') ?? env[TASK_ENV]
	const t = v?.trim()
	return t ? t : undefined
}

/** Ссылка на задачу в панели (хост и порт — как у клиента CLI). */
export function taskUrl(e: Endpoint, id: string): string {
	return `http://${e.host}:${e.port}/?task=${encodeURIComponent(id)}`
}

/** Итог задачи из --summary или --summary-file (undefined — не задан). */
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

function needId(id: string | undefined, sub: string): string {
	if (!id) throw new CliError(`использование: nessy-orch task ${sub} <id>`, 2)
	return id
}

function printTask(t: TaskView, agents: readonly AgentView[]): void {
	out(`${bold(t.id)}  ${status(t.status)}  ${t.title}`)
	out(dim(`владелец: ${t.owner ?? '—'} · создана ${t.createdAt} · обновлена ${t.updatedAt}`))
	out(dim(`панель: ${taskUrl(ep, t.id)}`))
	out('')
	out(taskAgentsTable(agents))
	if (t.summary) out(`\n${bold('Итог')}\n${t.summary}`)
}

async function cmdTask(p: Parsed): Promise<void> {
	const [sub, ...rest] = p.positionals
	const asJson = flagBool(p, 'json')
	if (sub === 'new') {
		const title = rest.join(' ').trim()
		if (!title) throw new CliError('использование: nessy-orch task new "<заголовок>" [--owner X] [--id slug]', 2)
		const body: TaskRequest = { title, owner: flagStr(p, 'owner'), id: flagStr(p, 'id') }
		const t = await post<TaskView>('/tasks', body)
		if (asJson) return json({ ...t, url: taskUrl(ep, t.id) })
		out(t.id)
		out(taskUrl(ep, t.id))
		return info(dim(`агенты задачи: nessy-orch spawn --task ${t.id} …; ответы: nessy-orch inbox --task ${t.id} --wait 1500`))
	}
	if (sub === 'ls' || sub === undefined) {
		const g = await get<GraphView>('/graph')
		const all = flagBool(p, 'all')
		const list = all ? g.tasks : g.tasks.filter(t => t.status === 'active')
		return asJson ? json(list) : out(tasksTable(list, g.agents, g.tasks.length - list.length))
	}
	if (sub === 'show') {
		const id = needId(rest[0], 'show')
		const [t, agents] = await Promise.all([get<TaskView>(`/tasks/${enc(id)}`), get<AgentView[]>(`/agents?task=${enc(id)}`)])
		return asJson ? json({ task: t, agents }) : printTask(t, agents)
	}
	if (sub === 'done' || sub === 'reopen') {
		const id = needId(rest[0], sub)
		const body: TaskPatch = { status: sub === 'done' ? 'done' : 'active' }
		const summary = readSummary(p)
		if (summary !== undefined) body.summary = summary
		const t = await patch<TaskView>(`/tasks/${enc(id)}`, body)
		return asJson ? json(t) : out(`${green('✓')} задача ${bold(t.id)}: ${sub === 'done' ? 'завершена' : 'снова активна'}`)
	}
	if (sub === 'rm') {
		const id = needId(rest[0], 'rm')
		await del(`/tasks/${enc(id)}`)
		return out(`${green('✓')} задача удалена: ${id} (её агенты остались вне задач)`)
	}
	throw new CliError(`неизвестная подкоманда task ${sub}\n${USAGE}`, 2)
}

export const taskCommands: CommandTable = {
	task: { run: cmdTask, spec: TASK_FLAGS },
}
