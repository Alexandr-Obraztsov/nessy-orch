/**
 * Хуки Claude Code: `nessy-orch hook start|prompt|stop|end`. Хуки задаёт плагин nessy (`hooks/hooks.json`), терминал приложения даёт
 * переменную NESSY_ORCH_TERMINAL; хук читает JSON события из stdin и печатает JSON-ответ в stdout (формат — domain/hooks.ts).
 * Хук не должен ломать Claude: любая ошибка (оркестратор недоступен, нет переменной) — тихий выход с кодом 0 и пустым выводом.
 */
import * as fs from 'node:fs'
import type { LeadState, RoleView, SessionUpdates, SessionView } from '../../../../shared/types'
import { deliveredCursor, leadKindOf, startContext, stopDecision, updatesContext } from '../../../domain/hooks'
import type { LeadKind } from '../../../domain/hooks'
import { isObject, parseJson } from '../../../lib/json'
import { enc, get, post } from '../io'
import type { CommandTable } from './command.types'

/** Хук не должен задерживать Claude дольше этого (мс). */
const HOOK_BUDGET_MS = 4000
const END_BUDGET_MS = 1000

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

/** Записать в поток и дождаться, пока данные приняты: подтверждать доставку можно только после этого. */
const write = (stream: NodeJS.WriteStream, text: string): Promise<boolean> =>
	new Promise(resolve => {
		try {
			stream.write(text, err => resolve(!err))
		} catch {
			resolve(false)
		}
	})

/** Ответы реально выведены хуком — сдвинуть курсор сессии. Не дошло (таймаут, обрыв) — ответы придут при следующем хуке или inbox. */
const ack = (session: string, u: SessionUpdates, nameOf: (id: string) => string): Promise<unknown> => {
	const cursor = deliveredCursor(u.replies, nameOf)
	return cursor ? post(`/sessions/${enc(session)}/ack`, { cursor }).catch(() => undefined) : Promise.resolve()
}

const setLead = (session: string, state: LeadState): Promise<unknown> => post<SessionView>(`/sessions/${enc(session)}/lead-state`, { state }).catch(() => undefined)

/**
 * Сессия оркестратора этого чата Claude: чат (session_id хука, в том числе после /resume) привязывается к сессии один раз и навсегда.
 * Первый чат окна берёт сессию окна (`NESSY_ORCH_SESSION`), следующий (новый чат, /clear) получает новую; без session_id — сессия окна.
 */
async function bindChat(chatId: string, windowSession: string, terminal: string, title: string, cwd: string, source: string): Promise<string | null> {
	if (!chatId) return windowSession || null
	try {
		const s = await post<SessionView>('/sessions/bind', { chatId: chatId, session: windowSession || undefined, terminal: terminal || undefined, title: title || undefined, cwd: cwd || undefined, source: source || undefined })
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

/**
 * Контекст для главного агента. Claude Code берёт простой текст stdout (SessionStart/UserPromptSubmit); nessy читает JSON хука
 * (`hookSpecificOutput.additionalContext`, формат из его документации).
 */
function contextOutput(kind: LeadKind, hookEvent: 'SessionStart' | 'UserPromptSubmit', text: string): string {
	return kind === 'claude' ? text + '\n' : JSON.stringify({ hookSpecificOutput: { hookEventName: hookEvent, additionalContext: text } }) + '\n'
}

async function run(event: string, windowSession: string, terminal: string, input: Record<string, unknown>, kind: LeadKind): Promise<void> {
	const chatId = typeof input['session_id'] === 'string' ? input['session_id'] : ''
	const cwd = typeof input['cwd'] === 'string' ? input['cwd'] : ''
	const source = typeof input['source'] === 'string' ? input['source'] : ''
	const session = await bindChat(chatId, windowSession, terminal, cwd.split('/').filter(Boolean).pop() ?? '', cwd, source)
	if (!session) return
	if (event === 'start') exportSession(session)
	const roles = (): Promise<RoleView[]> => get<RoleView[]>('/roles').catch(() => [])
	const updates = (): Promise<SessionUpdates> => get<SessionUpdates>(`/sessions/${enc(session)}/updates`)
	const names = (u: SessionUpdates, rs: readonly RoleView[]): { roleName: (id: string | null) => string | null; nameOf: (id: string) => string } => ({
		roleName: id => (id ? (rs.find(r => r.id === id)?.name ?? id) : null),
		nameOf: id => u.agents.find(a => a.id === id)?.name ?? id,
	})

	if (event === 'start') {
		const [s, rs, u] = await Promise.all([get<SessionView>(`/sessions/${enc(session)}`), roles(), updates(), setLead(session, 'idle')])
		// /resume: у возобновлённого чата уже есть агенты и, возможно, непрочитанные ответы — сразу в контекст
		const n = names(u, rs)
		const state = updatesContext(u, n.roleName, n.nameOf, session, kind)
		// stdout SessionStart уходит в контекст главного агента
		if (await write(process.stdout, contextOutput(kind, 'SessionStart', [startContext(s, rs, kind), state].filter(Boolean).join('\n\n')))) await ack(session, u, n.nameOf)
	} else if (event === 'prompt') {
		const [u, rs] = await Promise.all([updates(), roles(), setLead(session, 'working')])
		const n = names(u, rs)
		const text = updatesContext(u, n.roleName, n.nameOf, session, kind)
		// stdout UserPromptSubmit уходит в контекст главного агента; ответы считаются доставленными только после записи
		if (text && (await write(process.stdout, contextOutput(kind, 'UserPromptSubmit', text)))) await ack(session, u, n.nameOf)
	} else if (event === 'stop') {
		const [u, rs] = await Promise.all([updates(), roles()])
		const n = names(u, rs)
		const decision = stopDecision(u, n.nameOf, { session, stopHookActive: input['stop_hook_active'] === true, kind })
		if (decision) {
			// код 2 + причина в stderr — «не останавливаться» без JSON-схемы (она у Stop строгая и менялась): так хук не может сломаться на валидации
			if (await write(process.stderr, decision.reason + '\n')) {
				process.exitCode = 2
				await ack(session, u, n.nameOf)
				await setLead(session, 'working') // Claude продолжает работу с ответами агентов
			}
		} else await setLead(session, 'idle')
	} else if (event === 'stop-failure') {
		// ход закончился ошибкой API вместо Stop: останавливать нечего, главный агент свободен
		await setLead(session, 'idle')
	} else if (event === 'end') {
		// /clear завершает чат, но не разговор: агент (а с ним сессия) продолжит жить в новом чате — «завершён» не ставим
		if (input['reason'] !== 'clear') await setLead(session, 'ended')
	}
}

/**
 * Хук Stop новой архитектуры: главный агент закончил ход. Только отчёт `idle` с актуальным chatId (session_id из события) —
 * ничего в контекст не печатается и ход не продлевается: ответы агентов вводит в терминал приложение (digest).
 */
async function runIdle(session: string, input: Record<string, unknown>): Promise<void> {
	const chatId = typeof input['session_id'] === 'string' ? input['session_id'] : ''
	await post(`/sessions/${enc(session)}/lead`, { idle: true, ...(chatId ? { chatId } : {}) }).catch(() => undefined)
}

async function cmdHook(p: { positionals: string[] }): Promise<void> {
	const input = readInput() // прочитать stdin целиком: Claude ждёт, пока хук заберёт ввод
	const event = p.positionals[0] ?? ''
	const session = process.env['NESSY_ORCH_SESSION']?.trim() ?? ''
	const terminal = process.env['NESSY_ORCH_TERMINAL']?.trim() ?? ''
	if (event === 'idle') {
		if (!session) return
		await Promise.race([runIdle(session, input), new Promise<void>(resolve => setTimeout(resolve, HOOK_BUDGET_MS).unref())])
		return
	}
	if ((!session && !terminal) || !['start', 'prompt', 'stop', 'stop-failure', 'end'].includes(event)) return
	try {
		// SessionEnd у Claude Code на всё про всё ~1,5 с: укладываемся, остальное успеют сервис и приложение
		const budget = event === 'end' ? END_BUDGET_MS : HOOK_BUDGET_MS
		await Promise.race([run(event, session, terminal, input, leadKindOf(process.env['NESSY_ORCH_LEAD'])), new Promise<void>(resolve => setTimeout(resolve, budget).unref())])
	} catch {
		/* хук не должен ломать Claude */
	}
}

export const hookCommands: CommandTable = {
	hook: { run: cmdHook, spec: { bool: ['help'] } },
}
