/** Диспетчер команд: разбор argv → команда, спецификация флагов, контекст, запуск. */
import { flagBool, flagStr, parseArgs } from './args'
import { CliError } from './errors'
import type { Ctx } from './ctx'
import { agentCommands } from './commands/agents'
import { feedCommands } from './commands/feed'
import { hookCommands } from './commands/hook'
import { roleCommands } from './commands/roles'
import { serviceCommands } from './commands/service'
import { sessionCommands } from './commands/sessions'
import { spaceCommands } from './commands/spaces'
import type { CommandTable } from './commands/command.types'
import { HELP } from './help'
import { isPathArg } from './launch'
import type { Transport } from './transport'

const COMMANDS: CommandTable = { ...agentCommands, ...sessionCommands, ...roleCommands, ...spaceCommands, ...feedCommands, ...hookCommands, ...serviceCommands }
export interface RunOptions {
	cwd: string
	env: NodeJS.ProcessEnv
	out: (s: string) => void
	info: (s: string) => void
}

/** Основная точка: имя команды + её аргументы. Возвращает результат (для тестов без process.exit). */
export async function runCommand(argv: readonly string[], t: Transport, opts: RunOptions): Promise<void> {
	// `nessy-orch .`, `nessy-orch ~/proj` — сокращение для `app <папка>`
	const args = isPathArg(argv[0]) ? ['app', ...argv] : argv
	const [name, ...rest] = args
	if (!name || name === 'help' || name === '--help' || name === '-h') return opts.out(HELP)
	const cmd = COMMANDS[name]
	if (!cmd) throw new CliError(`неизвестная команда «${name}». См. nessy-orch --help`, 2)
	const p = parseArgs(rest, cmd.spec)
	if (flagBool(p, 'help')) return opts.out(HELP)
	// ключ агента (`--key`) из любого флага: идёт в заголовок X-Agent-Key для команд от имени агента (`--from`)
	t.setAgentKey(flagStr(p, 'key'))
	const ctx: Ctx = { t, p, cwd: opts.cwd, env: opts.env, out: opts.out, info: opts.info, json: v => opts.out(JSON.stringify(v, null, 2)) }
	await cmd.run(ctx)
}
