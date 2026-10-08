import type { FlagSpec } from '../args.types'

export const COMMON: FlagSpec = { bool: ['json', 'help'] }
export const WAIT_FLAGS: FlagSpec = {
	bool: ['json', 'help', 'wait'],
	value: ['timeout', 'from', 'space', 'name'],
	short: { w: 'wait' },
}
