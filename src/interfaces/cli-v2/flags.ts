/**
 * Флаги команд cli-v2. Семантика — как у текущего CLI (совместимость), плюс новые:
 * `--runtime` и `--model` у spawn. Общие флаги `--json`/`--help` — у всех.
 */
import type { FlagSpec } from '../cli/args.types'

export const COMMON: FlagSpec = { bool: ['json', 'help'] }

export const WAIT_FLAGS: FlagSpec = {
	bool: ['json', 'help', 'wait', 'no-wait'],
	value: ['timeout', 'from', 'space', 'name', 'title', 'key'],
	short: { w: 'wait' },
}

/** spawn: --role, --session, --runtime (RuntimeId), --model (модель рантайма) */
export const SPAWN_FLAGS: FlagSpec = {
	bool: ['json', 'help', 'wait', 'no-wait'],
	value: ['timeout', 'from', 'space', 'name', 'title', 'role', 'session', 'runtime', 'model', 'key'],
	short: { w: 'wait' },
}

/** send: --interrupt — прервать текущий ход адресата и доставить первым */
export const SEND_FLAGS: FlagSpec = { bool: ['json', 'help', 'wait', 'no-wait', 'interrupt'], value: ['timeout', 'from', 'key'], short: { w: 'wait' } }

/** ask: как spawn --wait, плюс --session */
export const ASK_FLAGS: FlagSpec = { bool: ['json', 'help', 'wait', 'no-wait'], value: ['timeout', 'from', 'space', 'key', 'session'], short: { w: 'wait' } }

export const WAIT_CMD_FLAGS: FlagSpec = { bool: ['json', 'help'], value: ['timeout'] }

/** ls: --all — с архивом, --session — только агенты сессии */
export const LS_FLAGS: FlagSpec = { bool: ['json', 'help', 'all'], value: ['session'], short: { a: 'all' } }

/** plan: --from — id агента-автора, --clear — убрать план */
export const PLAN_FLAGS: FlagSpec = { bool: ['json', 'help', 'clear'], value: ['from', 'key'] }

export const SHOW_FLAGS: FlagSpec = { bool: ['json', 'help'], value: ['n'] }

/** feed: --follow — подписка на новые события */
export const FEED_FLAGS: FlagSpec = { bool: ['json', 'help', 'follow'], value: ['n'], short: { f: 'follow' } }

export const SESSION_FLAGS: FlagSpec = { bool: ['json', 'help', 'all'], value: ['owner', 'id', 'summary', 'summary-file'], short: { a: 'all' } }

export const ROLE_FLAGS: FlagSpec = {
	bool: ['json', 'help', 'force', 'dry-run'],
	value: ['instructions', 'file', 'description', 'id', 'color', 'icon', 'package-dir', 'out'],
}

export const SPACE_FLAGS: FlagSpec = { bool: ['json', 'help', 'force'], value: ['name', 'url'] }
