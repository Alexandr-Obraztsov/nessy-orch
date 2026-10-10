/** Служебные команды: status, open, install, uninstall. */
import { execFileSync, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import type { StatusResponse } from '../../../../shared/types'
import { flagBool } from '../args'
import type { Parsed } from '../args.types'
import { green } from '../format'
import { CliError } from '../errors'
import { resolveDir, terminalUrl } from '../launch'
import { ep, get, json, out } from '../io'
import { install, uninstall } from '../launchd'
import type { CommandTable } from './command.types'
import { COMMON } from './flags'

async function cmdStatus(p: Parsed): Promise<void> {
	const s = await get<StatusResponse>('/status')
	if (flagBool(p, 'json')) return json(s)
	out(`${green('●')} nessy-orch ${s.version}  pid ${s.pid}  uptime ${s.uptimeSec}s`)
	out(`  http://127.0.0.1:${ep.port}   home: ${s.home}`)
	out(`  пространств: ${s.spaces}   агентов: ${s.agents} (работают: ${s.working})   ролей: ${s.roles}   автоподтверждение: ${s.autoApprove ? 'вкл' : 'выкл'}`)
}

/** Открыть приложение TClaude-Orch (или конкретную сессию: `open <id сессии>`). */
function cmdOpen(p: Parsed): Promise<void> {
	const id = p.positionals[0]
	const url = id ? `nessy-orch://session/${encodeURIComponent(id)}` : 'nessy-orch://open'
	out(url)
	spawn('open', [url], { stdio: 'ignore', detached: true })
		.on('error', () => undefined)
		.unref()
	return Promise.resolve()
}

/** `nessy-orch app [папка]` / `nessy-orch .`: открыть приложение с терминалом в этой папке (по умолчанию — текущей). */
function cmdApp(p: Parsed): Promise<void> {
	const dir = resolveDir(p.positionals[0])
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new CliError(`не папка: ${dir}`, 2)
	const url = terminalUrl(dir)
	try {
		execFileSync('open', [url], { stdio: 'ignore' })
	} catch {
		throw new CliError('не удалось открыть приложение TClaude-Orch: оно не установлено (app/release/TClaude-Orch-macOS.zip) или нет macOS-команды open')
	}
	out(dir)
	return Promise.resolve()
}

export const serviceCommands: CommandTable = {
	app: { run: cmdApp, spec: COMMON },
	status: { run: cmdStatus, spec: COMMON },
	open: { run: cmdOpen, spec: COMMON },
	install: { run: p => install({ print: flagBool(p, 'print') }), spec: { bool: ['help', 'print'] } },
	uninstall: { run: () => uninstall(), spec: COMMON },
}
