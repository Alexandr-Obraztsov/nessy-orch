/**
 * Хуки Claude Code: `nessy-orch hook start|prompt|stop|end`. Хуки задаёт плагин nessy (`hooks/hooks.json`), терминал приложения даёт
 * переменную NESSY_ORCH_TERMINAL; хук читает JSON события из stdin и печатает JSON-ответ в stdout (формат — domain/hooks.ts).
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

/**
 * Сессия оркестратора этого чата Claude: чат (session_id хука, в том числе после /resume) привязывается к сессии один раз и навсегда.
 * Первый чат окна берёт сессию окна (`NESSY_ORCH_SESSION`), следующий (новый чат, /clear) получает новую; без session_id — сессия окна.
 */
async function bindSession(claudeId: string, windowSession: string, terminal: string, title: string): Promise<string | null> {
	if (!claudeId) return windowSession || null
	try {
		const s = await post<SessionView>('/sessions/bind', { claudeSession: claudeId, session: windowSession || undefined, terminal: terminal || undefined, title: title || undefined })
		return s.id
	} catch {
		return windowSession || null
	}
}

/** `CLAUDE_ENV_FILE` (есть только у SessionStart): Bash-инструменты Claude видят сессию этого чата в `NESSY_ORCH_SESSION`. */
function exportSession(session: string): void {
	const file = process.env['CLAUDE_ENV_FILE']
	if (!file) return
	try {
		fs.appendFileSync(file, `export NESSY_ORCH_SESSION='${session.replace(/'/g, '')}'\n`)
	} catch {
		/* не критично */
	}
}

async function run(event: string, windowSession: string, terminal: string, input: Record<string, unknown>): Promise<void> {
	const claudeId = typeof input['session_id'] === 'string' ? input['session_id'] : ''
	const cwd = typeof input['cwd'] === 'string' ? input['cwd'] : ''
	const session = await bindSession(claudeId, windowSession, terminal, cwd.split('/').filter(Boolean).pop() ?? '')
	if (!session) return
	if (event === 'start') exportSession(session)
	const roles = (): Promise<RoleView[]> => get<RoleView[]>('/roles').catch(() => [])
	const updates = (): Promise<SessionUpdates> => get<SessionUpdates>(`/sessions/${enc(session)}/updates?consume=1`)
	const names = (u: SessionUpdates, rs: readonly RoleView[]): { roleName: (id: string | null) => string | null; nameOf: (id: string) => string } => ({
		roleName: id => (id ? (rs.find(r => r.id === id)?.name ?? id) : null),
		nameOf: id => u.agents.find(a => a.id === id)?.name ?? id,
	})

	if (event === 'start') {
		const [s, rs, u] = await Promise.all([get<SessionView>(`/sessions/${enc(session)}`), roles(), updates(), ping(session, 'idle')])
		// /resume: у возобновлённого чата уже есть агенты и, возможно, непрочитанные ответы — сразу в контекст
		const n = names(u, rs)
		const state = updatesContext(u, n.roleName, n.nameOf, session)
		out(contextOutput('SessionStart', [startContext(s, rs), state].filter(Boolean).join('\n\n')))
	} else if (event === 'prompt') {
		const [u, rs] = await Promise.all([updates(), roles(), ping(session, 'working')])
		const n = names(u, rs)
		const text = updatesContext(u, n.roleName, n.nameOf, session)
		if (text) out(contextOutput('UserPromptSubmit', text))
	} else if (event === 'stop') {
		const [u, rs] = await Promise.all([updates(), roles()])
		const decision = stopDecision(u, names(u, rs).nameOf, { session, stopHookActive: input['stop_hook_active'] === true })
		if (decision) {
			await ping(session, 'working') // Claude продолжает работу с ответами агентов
			out(JSON.stringify(decision))
		} else await ping(session, 'idle')
	} else if (event === 'end') {
		await ping(session, 'ended')
	}
}

async function cmdHook(p: { positionals: string[] }): Promise<void> {
	const input = readInput() // прочитать stdin целиком: Claude ждёт, пока хук заберёт ввод
	const event = p.positionals[0] ?? ''
	const session = process.env['NESSY_ORCH_SESSION']?.trim() ?? ''
	const terminal = process.env['NESSY_ORCH_TERMINAL']?.trim() ?? ''
	if ((!session && !terminal) || !['start', 'prompt', 'stop', 'end'].includes(event)) return
	try {
		await Promise.race([run(event, session, terminal, input), new Promise<void>(resolve => setTimeout(resolve, HOOK_BUDGET_MS).unref())])
	} catch {
		/* хук не должен ломать Claude */
	}
}

export const hookCommands: CommandTable = {
	hook: { run: cmdHook, spec: { bool: ['help'] } },
}
