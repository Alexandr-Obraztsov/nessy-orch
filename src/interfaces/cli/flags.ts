/** Флаги команд. Общие `--json`/`--help` — у всех; у spawn ещё `--runtime` и `--model`. */
import type { FlagSpec } from './args.types'

export const COMMON: FlagSpec = { bool: ['json', 'help'] }

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
	value: ['instructions', 'file', 'description', 'id', 'color', 'icon', 'model', 'runtime'],
}

export const SPACE_FLAGS: FlagSpec = { bool: ['json', 'help', 'force'], value: ['name', 'url'] }

/** learn: --session, --revert <id записи журнала>, --limit */
export const LEARN_FLAGS: FlagSpec = { bool: ['json', 'help', 'all'], value: ['session', 'revert', 'limit'], short: { a: 'all' } }

/** case: --file, --final, --cards; --from/--key — от имени агента-сборщика (`case draft`) */
export const CASE_FLAGS: FlagSpec = { bool: ['json', 'help', 'final', 'cards'], value: ['file', 'from', 'key'] }

export const PLAYBOOK_FLAGS: FlagSpec = { bool: ['json', 'help', 'cards'], value: ['reason', 'version'] }

export const HOOK_FLAGS: FlagSpec = { bool: ['help'] }

/** install: --print — только вывести plist, --ensure — ничего не делать, если служба уже актуальна */
export const INSTALL_FLAGS: FlagSpec = { bool: ['help', 'print', 'ensure'] }
