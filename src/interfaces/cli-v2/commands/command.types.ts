/** Тип команды cli-v2: спецификация флагов + функция над контекстом. */
import type { FlagSpec } from '../../cli/args.types'
import type { Ctx } from '../ctx'

export interface Command {
	run: (ctx: Ctx) => Promise<void>
	spec: FlagSpec
}

export type CommandTable = Record<string, Command>
