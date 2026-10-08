/** Служебные команды: status, open, install, uninstall. */
import { spawn } from 'node:child_process'
import type { StatusResponse } from '../../../../shared/types'
import { flagBool } from '../args'
import type { Parsed } from '../args.types'
import { green } from '../format'
import { ep, get, json, out } from '../io'
import { install, uninstall } from '../launchd'
import type { CommandTable } from './command.types'
import { COMMON } from './flags'

async function cmdStatus(p: Parsed): Promise<void> {
	const s = await get<StatusResponse>('/status')
	if (flagBool(p, 'json')) return json(s)
	out(`${green('●')} nessy-orch ${s.version}  pid ${s.pid}  uptime ${s.uptimeSec}s`)
	out(`  http://127.0.0.1:${ep.port}   home: ${s.home}`)
	out(`  пространств: ${s.spaces}   агентов: ${s.agents} (работают: ${s.working})   автоподтверждение: ${s.autoApprove ? 'вкл' : 'выкл'}`)
}

function cmdOpen(): Promise<void> {
	const url = `http://127.0.0.1:${ep.port}/`
	out(url)
	spawn('open', [url], { stdio: 'ignore', detached: true })
		.on('error', () => undefined)
		.unref()
	return Promise.resolve()
}

export const serviceCommands: CommandTable = {
	status: { run: cmdStatus, spec: COMMON },
	open: { run: cmdOpen, spec: COMMON },
	install: { run: p => install({ print: flagBool(p, 'print') }), spec: { bool: ['help', 'print'] } },
	uninstall: { run: () => uninstall(), spec: COMMON },
}
