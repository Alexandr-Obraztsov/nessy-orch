/**
 * Хук Claude Code: `nessy-orch hook stop` — единственный хук плагина (plugins/nessy/hooks/hooks.json). Запускается, когда Claude
 * закончил ход: отчитывается серверу (свободен, актуальный chatId) и решает, надо ли вернуть Claude к работе (domain/stop-hook.ts).
 * Хук не должен ломать Claude: любая ошибка (оркестратор недоступен, нет переменной) — тихий выход с кодом 0.
 * «Не останавливайся» — код 2 и причина в stderr: у Stop JSON-схема строгая и менялась, так хук не ломается на валидации.
 */
import * as fs from 'node:fs'
import type { DigestResponse } from '../../../../shared/types'
import { stopDecision } from '../../../domain/stop-hook'
import { isObject, parseJson } from '../../../lib/json'
import { enc, get, post } from '../io'
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

/** Записать в поток и дождаться, пока данные приняты: подтверждать доставку можно только после этого. */
const write = (stream: NodeJS.WriteStream, text: string): Promise<boolean> =>
	new Promise(resolve => {
		try {
			stream.write(text, err => resolve(!err))
		} catch {
			resolve(false)
		}
	})

async function runStop(session: string, input: Record<string, unknown>): Promise<void> {
	const chatId = typeof input['session_id'] === 'string' ? input['session_id'] : ''
	const digest = await get<DigestResponse>(`/sessions/${enc(session)}/digest`)
	const d = stopDecision(digest, session, input['stop_hook_active'] === true)
	// сообщаем состояние: «свободен» только если Claude действительно останавливается
	await post(`/sessions/${enc(session)}/lead`, { idle: d.reason === null, ...(chatId ? { chatId } : {}) }).catch(() => undefined)
	if (d.reason === null) return
	if (await write(process.stderr, d.reason + '\n')) {
		process.exitCode = 2
		if (d.ackCursor) await post(`/sessions/${enc(session)}/ack`, { cursor: d.ackCursor }).catch(() => undefined)
	}
}

async function cmdHook(p: { positionals: string[] }): Promise<void> {
	const input = readInput() // прочитать stdin целиком: Claude ждёт, пока хук заберёт ввод
	const session = process.env['NESSY_ORCH_SESSION']?.trim() ?? ''
	if (p.positionals[0] !== 'stop' || !session) return
	try {
		await Promise.race([runStop(session, input), new Promise<void>(resolve => setTimeout(resolve, HOOK_BUDGET_MS).unref())])
	} catch {
		/* хук не должен ломать Claude */
	}
}

export const hookCommands: CommandTable = {
	hook: { run: cmdHook, spec: { bool: ['help'] } },
}
