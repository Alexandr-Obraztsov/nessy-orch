import type { FlagSpec } from '../args.types'

export const COMMON: FlagSpec = { bool: ['json', 'help'] }
export const WAIT_FLAGS: FlagSpec = {
	bool: ['json', 'help', 'wait', 'no-wait'],
	value: ['timeout', 'from', 'space', 'name', 'title', 'key'],
	short: { w: 'wait' },
}
/** send: --interrupt — прервать текущий ход адресата и доставить сообщение первым (по умолчанию работающего не прерываем) */
export const SEND_FLAGS: FlagSpec = { bool: ['json', 'help', 'wait', 'no-wait', 'interrupt'], value: ['timeout', 'from', 'key'], short: { w: 'wait' } }
/** spawn: --role — роль из `nessy-orch role ls`, --session — сессия (по умолчанию NESSY_ORCH_SESSION) */
export const SPAWN_FLAGS: FlagSpec = { ...WAIT_FLAGS, value: [...(WAIT_FLAGS.value ?? []), 'role', 'session'] }
/** wait: дождаться агента */
export const WAIT_CMD_FLAGS: FlagSpec = { bool: ['json', 'help'], value: ['timeout'] }
/** ask: как spawn --wait, плюс --session */
export const ASK_FLAGS: FlagSpec = { ...WAIT_FLAGS, value: [...(WAIT_FLAGS.value ?? []), 'session'] }
/** ls: --all — с архивом, --session — только агенты сессии */
export const LS_FLAGS: FlagSpec = { bool: ['json', 'help', 'all'], value: ['session'], short: { a: 'all' } }
/** plan: --from — id агента-автора, --clear — убрать план */
export const PLAN_FLAGS: FlagSpec = { bool: ['json', 'help', 'clear'], value: ['from', 'key'] }
