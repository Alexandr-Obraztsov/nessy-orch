#!/usr/bin/env node
/**
 * nessy-orch — единый CLI оркестратора.
 * Правило вывода: полезный результат (ответ агента, JSON) — в stdout, служебное — в stderr.
 * Так `nessy-orch spawn --wait ...` удобно читать и главному агенту, и скриптам.
 */
import { errMsg } from '../../lib/json'
import { flagBool, flagStr, parseArgs } from './args'
import { agentCommands } from './commands/agents.commands'
import type { CommandTable } from './commands/command.types'
import { hookCommands } from './commands/hook.commands'
import { feedCommands } from './commands/feed.commands'
import { roleCommands } from './commands/roles.commands'
import { serviceCommands } from './commands/service.commands'
import { spaceCommands } from './commands/spaces.commands'
import { sessionCommands } from './commands/sessions.commands'
import { setAgentKey } from './client'
import { CliError } from './errors'
import { red } from './format'
import { HELP } from './help'
import { isPathArg } from './launch'
import { info, out } from './io'

const COMMANDS: CommandTable = { ...agentCommands, ...feedCommands, ...hookCommands, ...spaceCommands, ...roleCommands, ...sessionCommands, ...serviceCommands }
const ALIASES: Record<string, string> = { list: 'ls', agents: 'ls', rm: 'kill', log: 'feed', messages: 'feed', spaces: 'space', roles: 'role', sessions: 'session' }

async function main(argv: string[]): Promise<void> {
	if (isPathArg(argv[0])) argv = ['app', ...argv]
	const [name, ...rest] = argv
	if (!name || name === 'help' || name === '--help' || name === '-h') return out(HELP)
	const cmd = COMMANDS[ALIASES[name] ?? name]
	if (!cmd) throw new CliError(`неизвестная команда «${name}». См. nessy-orch --help`, 2)
	const p = parseArgs(rest, cmd.spec)
	if (flagBool(p, 'help')) return out(HELP)
	setAgentKey(cmd.spec.value?.includes('key') ? flagStr(p, 'key') : undefined)
	await cmd.run(p)
}

main(process.argv.slice(2)).catch((e: unknown) => {
	info(red('✗ ') + errMsg(e))
	process.exit(e instanceof CliError ? e.exitCode : 1)
})
