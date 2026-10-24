/** Служебные команды: status, open, app, install, uninstall. */
import { execFileSync, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import type { StatusResponse } from '../../../../shared/types'
import { flagBool } from '../args'
import { CliError } from '../errors'
import type { Ctx } from '../ctx'
import { COMMON, INSTALL_FLAGS } from '../flags'
import { green } from '../format'
import { resolveDir, terminalUrl } from '../launch'
import { install, uninstall } from '../launchd'
import type { CommandTable } from './command.types'

async function cmdStatus(c: Ctx): Promise<void> {
	const s = await c.t.get<StatusResponse>('/status')
	if (flagBool(c.p, 'json')) return c.json(s)
	c.out(`${green('●')} nessy-orch ${s.version}  pid ${s.pid}  uptime ${s.uptimeSec}с`)
	c.out(`  пространств: ${s.spaces}   агентов: ${s.agents} (работают: ${s.working})   ролей: ${s.roles}   автоподтверждение: ${s.autoApprove ? 'вкл' : 'выкл'}`)
}

/** Открыть приложение TClaude-Orch (или конкретную сессию: `open <id сессии>`). */
function cmdOpen(c: Ctx): Promise<void> {
	const id = c.p.positionals[0]
	const url = id ? `nessy-orch://session/${encodeURIComponent(id)}` : 'nessy-orch://open'
	c.out(url)
	spawn('open', [url], { stdio: 'ignore', detached: true })
		.on('error', () => undefined)
		.unref()
	return Promise.resolve()
}

/** `nessy-orch app [папка]` / `nessy-orch .`: открыть приложение с терминалом в этой папке (по умолчанию — текущей). */
function cmdApp(c: Ctx): Promise<void> {
	const dir = resolveDir(c.p.positionals[0], c.cwd)
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new CliError(`не папка: ${dir}`, 2)
	try {
		execFileSync('open', [terminalUrl(dir)], { stdio: 'ignore' })
	} catch {
		throw new CliError('не удалось открыть приложение TClaude-Orch: оно не установлено или нет macOS-команды open')
	}
	c.out(dir)
	return Promise.resolve()
}

export const serviceCommands: CommandTable = {
	status: { run: cmdStatus, spec: COMMON },
	open: { run: cmdOpen, spec: COMMON },
	app: { run: cmdApp, spec: COMMON },
	install: { run: c => install({ print: flagBool(c.p, 'print'), ensure: flagBool(c.p, 'ensure') }), spec: INSTALL_FLAGS },
	uninstall: { run: () => uninstall(), spec: COMMON },
}
