#!/usr/bin/env node
/**
 * nessy-orch — единый CLI оркестратора.
 * Правило вывода: полезный результат (ответ агента, JSON) — в stdout, служебное — в stderr.
 * Так `nessy-orch spawn --wait ...` удобно читать и главному агенту, и скриптам.
 */
import { errMsg } from '../../lib/json'
import { flagBool, parseArgs } from './args'
import { agentCommands } from './commands/agents.commands'
import type { CommandTable } from './commands/command.types'
import { feedCommands } from './commands/feed.commands'
import { roleCommands } from './commands/roles.commands'
import { serviceCommands } from './commands/service.commands'
import { spaceCommands } from './commands/spaces.commands'
import { CliError } from './errors'
import { red } from './format'
import { HELP } from './help'
import { info, out } from './io'

const COMMANDS: CommandTable = { ...agentCommands, ...feedCommands, ...spaceCommands, ...roleCommands, ...serviceCommands }
const ALIASES: Record<string, string> = { list: 'ls', agents: 'ls', rm: 'kill', log: 'feed', messages: 'feed', spaces: 'space', roles: 'role' }

async function main(argv: string[]): Promise<void> {
	const [name, ...rest] = argv
	if (!name || name === 'help' || name === '--help' || name === '-h') return out(HELP)
	const cmd = COMMANDS[ALIASES[name] ?? name]
	if (!cmd) throw new CliError(`неизвестная команда «${name}». См. nessy-orch --help`, 2)
	const p = parseArgs(rest, cmd.spec)
	if (flagBool(p, 'help')) return out(HELP)
	await cmd.run(p)
}

main(process.argv.slice(2)).catch((e: unknown) => {
	info(red('✗ ') + errMsg(e))
	process.exit(e instanceof CliError ? e.exitCode : 1)
})
