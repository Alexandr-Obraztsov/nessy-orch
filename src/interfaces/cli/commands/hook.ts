/**
 * Хук Claude Code `nessy-orch hook start` (SessionStart) — единственный хук плагина. Сессия оркестратора привязана к чату Claude:
 * при запуске, `/clear` и `/resume` хук сообщает серверу id чата (`session_id`) и получает сессию этого чата (новую после `/clear`),
 * а её id записывает в `CLAUDE_ENV_FILE`, чтобы команды Claude (`nessy-orch …` в Bash) работали с новой сессией. Вкладка приложения идёт за ней
 * по цепочке `successor`. Хук не должен ломать Claude: любая ошибка (оркестратор недоступен, нет переменной) — тихий выход с кодом 0.
 */
import * as fs from 'node:fs'
import type { SessionView } from '../../../../shared/types'
import { isObject, parseJson } from '../../../lib/json'
import type { Ctx } from '../ctx'
import { HOOK_FLAGS } from '../flags'
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

async function runStart(c: Ctx, from: string, input: Record<string, unknown>): Promise<void> {
	const chatId = typeof input['session_id'] === 'string' ? input['session_id'] : ''
	const cwd = typeof input['cwd'] === 'string' ? input['cwd'] : ''
	if (!chatId) return
	const s = await c.t.post<SessionView>('/sessions/attach', { chatId, ...(cwd ? { cwd } : {}), from })
	// Bash-инструменты Claude подхватывают переменную из этого файла: дальше `nessy-orch` работает в сессии нового чата
	const file = c.env['CLAUDE_ENV_FILE']
	if (file && s.id !== from) {
		try {
			fs.appendFileSync(file, `export NESSY_ORCH_SESSION='${s.id.replace(/'/g, '')}'\n`)
		} catch {
			/* не критично: сессия привязана на сервере, вкладка её видит */
		}
	}
}

async function cmdHook(c: Ctx): Promise<void> {
	const input = readInput() // прочитать stdin целиком: Claude ждёт, пока хук заберёт ввод
	const session = c.env['NESSY_ORCH_SESSION']?.trim() ?? ''
	if (c.p.positionals[0] !== 'start' || !session) return
	try {
		await Promise.race([runStart(c, session, input), new Promise<void>(resolve => setTimeout(resolve, HOOK_BUDGET_MS).unref())])
	} catch {
		/* хук не должен ломать Claude */
	}
}

export const hookCommands: CommandTable = {
	hook: { run: cmdHook, spec: HOOK_FLAGS },
}
