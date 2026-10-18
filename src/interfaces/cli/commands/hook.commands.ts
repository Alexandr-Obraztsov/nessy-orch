/**
 * Хуки Claude Code плагина nessy, только в терминале приложения (задан `NESSY_ORCH_SESSION`).
 * `hook agent` (PreToolUse на Agent) — напоминание поручать работу агентам nessy, см. `runAgent`.
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
import { agentReminderOutput, sessionStartOutput } from '../hook-context'
import { post } from '../io'
import type { CommandTable } from './command.types'

/** Хук не должен задерживать Claude дольше этого (мс). */
const HOOK_BUDGET_MS = 4000

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
async function runStart(from: string, input: Record<string, unknown>): Promise<string> {
	const chatId = typeof input['session_id'] === 'string' ? input['session_id'] : ''
	const cwd = typeof input['cwd'] === 'string' ? input['cwd'] : ''
	const transcriptPath = typeof input['transcript_path'] === 'string' ? input['transcript_path'] : ''
	if (!chatId) return from
	const s = await post<SessionView>('/sessions/attach', { chatId, ...(cwd ? { cwd } : {}), ...(transcriptPath ? { transcriptPath } : {}), from })
	// Bash-инструменты Claude подхватывают переменную из этого файла: дальше `nessy-orch` работает в сессии нового чата
	const file = process.env['CLAUDE_ENV_FILE']
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

async function cmdHook(p: { positionals: string[] }): Promise<void> {
	const input = readInput() // прочитать stdin целиком: Claude ждёт, пока хук заберёт ввод
	const session = process.env['NESSY_ORCH_SESSION']?.trim() ?? ''
	if (!session) return
	if (p.positionals[0] === 'agent') return runAgent(input)
	if (p.positionals[0] !== 'start') return
	let id = session
	try {
		id = (await Promise.race([runStart(session, input), new Promise<string>(resolve => setTimeout(() => resolve(session), HOOK_BUDGET_MS).unref())])) || session
	} catch {
		/* хук не должен ломать Claude: оркестратор недоступен — указание загрузить скилл всё равно нужно */
	}
	// указание загрузить скилл оркестратора; в терминале приложения оно нужно всегда, даже если привязка не удалась
	// выход сразу после записи: незавершённые повторы подключения к оркестратору не должны держать процесс до таймаута хука
	process.stdout.write(sessionStartOutput(id) + '\n', () => process.exit(0))
}

export const hookCommands: CommandTable = {
	hook: { run: cmdHook, spec: { bool: ['help'] } },
}
