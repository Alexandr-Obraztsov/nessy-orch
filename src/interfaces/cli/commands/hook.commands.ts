/**
 * Хуки Claude Code: `nessy-orch hook start|prompt|stop|end`. Приложение запускает Claude с `--settings` (хуки на эти команды) и
 * переменной NESSY_ORCH_SESSION; хук читает JSON события из stdin и печатает JSON-ответ в stdout (формат — domain/hooks.ts).
 * Хук не должен ломать Claude: любая ошибка (оркестратор недоступен, нет переменной) — тихий выход с кодом 0 и пустым выводом.
 */
import * as fs from 'node:fs'
import type { ClaudeState, RoleView, SessionUpdates, SessionView } from '../../../../shared/types'
import { contextOutput, startContext, stopDecision, updatesContext } from '../../../domain/hooks'
import { isObject, parseJson } from '../../../lib/json'
import { enc, get, out, post } from '../io'
import type { CommandTable } from './command.types'

/** Хук не должен задерживать Claude дольше этого (мс). */
const HOOK_BUDGET_MS = 2500

/** JSON события из stdin (если он не терминал); пустой объект при любой проблеме. */
function readInput(): Record<string, unknown> {
	if (process.stdin.isTTY) return {}
	try {
		const j = parseJson(fs.readFileSync(0, 'utf8'))
		return isObject(j) ? j : {}
	} catch {
		return {}
	}
}

const ping = (session: string, state: ClaudeState): Promise<unknown> => post<SessionView>(`/sessions/${enc(session)}/ping`, { state }).catch(() => undefined)

async function run(event: string, session: string): Promise<void> {
	readInput() // прочитать stdin целиком: Claude ждёт, пока хук заберёт ввод
	const roles = (): Promise<RoleView[]> => get<RoleView[]>('/roles').catch(() => [])
	const updates = (): Promise<SessionUpdates> => get<SessionUpdates>(`/sessions/${enc(session)}/updates?consume=1`)
	const names = (u: SessionUpdates, rs: readonly RoleView[]): { roleName: (id: string | null) => string | null; nameOf: (id: string) => string } => ({
		roleName: id => (id ? (rs.find(r => r.id === id)?.name ?? id) : null),
		nameOf: id => u.agents.find(a => a.id === id)?.name ?? id,
	})

	if (event === 'start') {
		const [s, rs] = await Promise.all([get<SessionView>(`/sessions/${enc(session)}`), roles(), ping(session, 'idle')])
		out(contextOutput('SessionStart', startContext(s, rs)))
	} else if (event === 'prompt') {
		const [u, rs] = await Promise.all([updates(), roles(), ping(session, 'working')])
		const n = names(u, rs)
		const text = updatesContext(u, n.roleName, n.nameOf)
		if (text) out(contextOutput('UserPromptSubmit', text))
	} else if (event === 'stop') {
		const [u, rs] = await Promise.all([updates(), roles()])
		const decision = stopDecision(u, names(u, rs).nameOf)
		if (decision) {
			await ping(session, 'working') // Claude продолжает работу с ответами агентов
			out(JSON.stringify(decision))
		} else await ping(session, 'idle')
	} else if (event === 'end') {
		await ping(session, 'ended')
	}
}

async function cmdHook(p: { positionals: string[] }): Promise<void> {
	const event = p.positionals[0] ?? ''
	const session = process.env['NESSY_ORCH_SESSION']?.trim()
	if (!session || !['start', 'prompt', 'stop', 'end'].includes(event)) return
	try {
		await Promise.race([run(event, session), new Promise<void>(resolve => setTimeout(resolve, HOOK_BUDGET_MS).unref())])
	} catch {
		/* хук не должен ломать Claude */
	}
}

export const hookCommands: CommandTable = {
	hook: { run: cmdHook, spec: { bool: ['help'] } },
}
