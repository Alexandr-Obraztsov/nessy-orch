import type { FlagSpec } from '../args.types'

export const COMMON: FlagSpec = { bool: ['json', 'help'] }
export const WAIT_FLAGS: FlagSpec = {
	bool: ['json', 'help', 'wait'],
	value: ['timeout', 'from', 'space', 'name'],
	short: { w: 'wait' },
}
/** send: --queue — не прерывать текущий ход, встать в очередь */
export const SEND_FLAGS: FlagSpec = { ...WAIT_FLAGS, bool: [...(WAIT_FLAGS.bool ?? []), 'queue'] }
/** spawn: --role — роль из `nessy-orch role ls`, --task — задача (по умолчанию NESSY_ORCH_TASK) */
export const SPAWN_FLAGS: FlagSpec = { ...WAIT_FLAGS, value: [...(WAIT_FLAGS.value ?? []), 'role', 'task'] }
/** ask: как spawn --wait, плюс --task */
export const ASK_FLAGS: FlagSpec = { ...WAIT_FLAGS, value: [...(WAIT_FLAGS.value ?? []), 'task'] }
/** ls: --all — с архивом, --task — только агенты задачи */
export const LS_FLAGS: FlagSpec = { bool: ['json', 'help', 'all'], value: ['task'], short: { a: 'all' } }
/** inbox: --task — ответы только агентов задачи (свой курсор) */
export const INBOX_FLAGS: FlagSpec = { bool: ['json', 'help', 'peek'], value: ['wait', 'task'] }
/** plan: --from — id агента-автора, --clear — убрать план */
export const PLAN_FLAGS: FlagSpec = { bool: ['json', 'help', 'clear'], value: ['from'] }
