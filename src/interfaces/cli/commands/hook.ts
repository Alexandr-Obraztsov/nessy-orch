/**
 * Хуки Claude Code плагина nessy, только в терминале приложения (задан `NESSY_ORCH_SESSION`).
 * `hook agent` (PreToolUse на Agent) — напоминание поручать работу агентам nessy, см. `runAgent`.
 * `hook prompt` (UserPromptSubmit) — подсказка плейбука обучения (`POST /learning/hint`), бюджет 1500 мс, при любой проблеме молчит.
 * `hook stop` (Stop, конец хода) и `hook end` (SessionEnd) — сигналы фонового обучения (`POST /learning/signal`: `activity` / `end`),
 * `hook prompt` тоже шлёт `activity`; бюджет 1500 мс, ничего не печатают, любая ошибка — код 0, выход сразу после записи.
 * `hook start` (SessionStart). Сессия оркестратора привязана к чату Claude:
 * при запуске, `/clear` и `/resume` хук сообщает серверу id чата (`session_id`) и получает сессию этого чата (новую после `/clear`),
 * а её id записывает в `CLAUDE_ENV_FILE`, чтобы команды Claude (`nessy-orch …` в Bash) работали с новой сессией. Вкладка приложения идёт за ней
 * по цепочке `successor`. В stdout хук отдаёт `additionalContext`: Claude первым делом загружает скилл оркестратора (`hook-context.ts`).
 * Хук не должен ломать Claude: любая ошибка (оркестратор недоступен, нет переменной) — выход с кодом 0.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SessionView } from '../../../../shared/types'
import { isObject, parseJson, str } from '../../../lib/json'
import type { Ctx } from '../ctx'
import { HOOK_FLAGS } from '../flags'
import { agentReminderOutput, hintOutput, sessionStartOutput } from '../hook-context'
import type { CommandTable } from './command.types'

/** Хук не должен задерживать Claude дольше этого (мс). */
const HOOK_BUDGET_MS = 4000

/** Бюджет запроса подсказки на каждый ход пользователя (мс): дольше — хук молчит. */
const HINT_BUDGET_MS = 1500

/** Сигнал обучения из события хука (`session_id`, `transcript_path`); не бросает, ждёт не дольше `HINT_BUDGET_MS`. */
function signal(c: Ctx, session: string, event: 'activity' | 'end', input: Record<string, unknown>): Promise<void> {
	const chatId = str(input['session_id'])
	const transcriptPath = str(input['transcript_path'])
	const send = c.t.post('/learning/signal', { event, session, ...(chatId ? { chatId } : {}), ...(transcriptPath ? { transcriptPath } : {}) }).then(
		() => undefined,
		() => undefined,
	)
	return Promise.race([send, new Promise<void>(resolve => setTimeout(resolve, HINT_BUDGET_MS).unref())])
}

/** Stop / SessionEnd: только сигнал, ничего не печатает; процесс выходит сразу, не дожидаясь повторов подключения. */
async function runSignal(c: Ctx, session: string, event: 'activity' | 'end', input: Record<string, unknown>): Promise<void> {
	await signal(c, session, event, input)
	process.exit(0)
}

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

/** Привязывает чат к сессии; возвращает id сессии этого чата (после `/clear` — новой). */
async function runStart(c: Ctx, from: string, input: Record<string, unknown>): Promise<string> {
	const chatId = typeof input['session_id'] === 'string' ? input['session_id'] : ''
	const cwd = typeof input['cwd'] === 'string' ? input['cwd'] : ''
	const transcriptPath = typeof input['transcript_path'] === 'string' ? input['transcript_path'] : ''
	if (!chatId) return from
	const s = await c.t.post<SessionView>('/sessions/attach', { chatId, ...(cwd ? { cwd } : {}), ...(transcriptPath ? { transcriptPath } : {}), from })
	// Bash-инструменты Claude подхватывают переменную из этого файла: дальше `nessy-orch` работает в сессии нового чата
	const file = c.env['CLAUDE_ENV_FILE']
	if (file && s.id !== from) {
		try {
			fs.appendFileSync(file, `export NESSY_ORCH_SESSION='${s.id.replace(/'/g, '')}'\n`)
		} catch {
			/* не критично: сессия привязана на сервере, вкладка её видит */
		}
	}
	return s.id
}

/**
 * PreToolUse для Agent: первый вызов в ходе пользователя (`prompt_id`) отклоняется с напоминанием про агентов nessy, повторный проходит.
 * Отметка «уже напомнили» — пустой файл во временной папке; ошибка файловой системы — вызов проходит без напоминания.
 */
function runAgent(input: Record<string, unknown>): void {
	const chat = str(input['session_id'])
	const turn = str(input['prompt_id'])
	const toolInput = input['tool_input']
	const type = isObject(toolInput) ? str(toolInput['subagent_type']) : ''
	const key = `${chat}-${turn}`.replace(/[^\w-]/g, '_')
	let first = false
	try {
		const dir = path.join(os.tmpdir(), 'nessy-orch-hooks')
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(path.join(dir, `agent-${key}`), '', { flag: 'wx' })
		first = true
	} catch {
		/* отметка уже есть (повторный вызов) или папка недоступна — не мешаем */
	}
	if (first) process.stdout.write(agentReminderOutput(type) + '\n')
}

/** UserPromptSubmit: подсказка плейбука. Ошибка, таймаут, пустой ответ — ничего не печатает. Процесс выходит сразу после записи. */
async function runPrompt(c: Ctx, session: string, input: Record<string, unknown>): Promise<void> {
	const prompt = str(input['prompt'])
	let out = ''
	// активность сессии — параллельно подсказке, подсказку не задерживает
	const active = signal(c, session, 'activity', input)
	if (prompt) {
		try {
			const r = await Promise.race([
				c.t.post<{ playbook: { id: string; skill: string; title: string } | null }>('/learning/hint', { session, prompt }),
				new Promise<null>(resolve => setTimeout(() => resolve(null), HINT_BUDGET_MS).unref()),
			])
			if (r?.playbook?.skill) out = hintOutput(r.playbook.skill, r.playbook.title) + '\n'
		} catch {
			/* хук не должен ломать Claude: оркестратор недоступен — без подсказки */
		}
	}
	await active
	// незавершённые повторы подключения не должны держать процесс до таймаута хука
	if (out) process.stdout.write(out, () => process.exit(0))
	else process.exit(0)
}

async function cmdHook(c: Ctx): Promise<void> {
	const input = readInput() // прочитать stdin целиком: Claude ждёт, пока хук заберёт ввод
	const session = c.env['NESSY_ORCH_SESSION']?.trim() ?? ''
	if (!session) return
	const sub = c.p.positionals[0]
	if (sub === 'agent') return runAgent(input)
	if (sub === 'prompt') return runPrompt(c, session, input)
	if (sub === 'stop') return runSignal(c, session, 'activity', input)
	if (sub === 'end') return runSignal(c, session, 'end', input)
	if (sub !== 'start') return
	let id = session
	try {
		id =
			(await Promise.race([runStart(c, session, input), new Promise<string>(resolve => setTimeout(() => resolve(session), HOOK_BUDGET_MS).unref())])) || session
	} catch {
		/* хук не должен ломать Claude: оркестратор недоступен — указание загрузить скилл всё равно нужно */
	}
	// указание загрузить скилл оркестратора; в терминале приложения оно нужно всегда, даже если привязка не удалась
	// выход сразу после записи: незавершённые повторы подключения к оркестратору не должны держать процесс до таймаута хука
	process.stdout.write(sessionStartOutput(id) + '\n', () => process.exit(0))
}

export const hookCommands: CommandTable = {
	hook: { run: cmdHook, spec: HOOK_FLAGS },
}
