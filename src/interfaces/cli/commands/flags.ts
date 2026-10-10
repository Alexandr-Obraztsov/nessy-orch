import type { FlagSpec } from '../args.types'

export const COMMON: FlagSpec = { bool: ['json', 'help'] }
export const WAIT_FLAGS: FlagSpec = {
	bool: ['json', 'help', 'wait'],
	value: ['timeout', 'from', 'space', 'name'],
	short: { w: 'wait' },
}
/** send: --queue — не прерывать текущий ход, встать в очередь */
export const SEND_FLAGS: FlagSpec = { ...WAIT_FLAGS, bool: [...(WAIT_FLAGS.bool ?? []), 'queue'] }
/** spawn: --role — роль из `nessy-orch role ls`, --session — сессия (по умолчанию NESSY_ORCH_SESSION) */
export const SPAWN_FLAGS: FlagSpec = { ...WAIT_FLAGS, value: [...(WAIT_FLAGS.value ?? []), 'role', 'session'] }
/** ask: как spawn --wait, плюс --session */
export const ASK_FLAGS: FlagSpec = { ...WAIT_FLAGS, value: [...(WAIT_FLAGS.value ?? []), 'session'] }
/** ls: --all — с архивом, --session — только агенты сессии */
export const LS_FLAGS: FlagSpec = { bool: ['json', 'help', 'all'], value: ['session'], short: { a: 'all' } }
/** inbox: --session — ответы только агентов сессии (свой курсор) */
export const INBOX_FLAGS: FlagSpec = { bool: ['json', 'help', 'peek'], value: ['wait', 'session'] }
/** plan: --from — id агента-автора, --clear — убрать план */
export const PLAN_FLAGS: FlagSpec = { bool: ['json', 'help', 'clear'], value: ['from'] }
