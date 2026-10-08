import type { FlagSpec, Parsed } from '../args.types'

export interface Command {
	run: (p: Parsed) => Promise<void>
	spec: FlagSpec
}

export type CommandTable = Record<string, Command>
