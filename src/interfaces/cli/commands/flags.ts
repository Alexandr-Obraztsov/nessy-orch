import type { FlagSpec } from '../args.types'

export const COMMON: FlagSpec = { bool: ['json', 'help'] }
export const WAIT_FLAGS: FlagSpec = {
	bool: ['json', 'help', 'wait'],
	value: ['timeout', 'from', 'space', 'name'],
	short: { w: 'wait' },
}
/** send: --queue — не прерывать текущий ход, встать в очередь */
export const SEND_FLAGS: FlagSpec = { ...WAIT_FLAGS, bool: [...(WAIT_FLAGS.bool ?? []), 'queue'] }
/** spawn: --role — роль из `nessy-orch role ls` */
export const SPAWN_FLAGS: FlagSpec = { ...WAIT_FLAGS, value: [...(WAIT_FLAGS.value ?? []), 'role'] }
