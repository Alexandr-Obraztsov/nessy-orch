import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DEFAULT_MAX_SERVES, DEFAULT_SERVE_IDLE_MIN } from '../../domain/constants'
import type { Config } from './config.types'

const int = (v: string | undefined, d: number): number => {
	const n = parseInt(v ?? '', 10)
	return Number.isFinite(n) ? n : d
}

/** Неотрицательное целое (отрицательное и мусор — значение по умолчанию). */
const nonNeg = (v: string | undefined, d: number): number => {
	const n = int(v, d)
	return n >= 0 ? n : d
}

const flag = (v: string | undefined, d: boolean): boolean => (v === undefined || v === '' ? d : !/^(0|false|no|off)$/i.test(v))

/** Корень проекта: ближайший сверху каталог с package.json (работает из src/ и из dist/). */
export function projectRoot(from: string = __dirname): string {
	let dir = from
	for (;;) {
		if (fs.existsSync(path.join(dir, 'package.json'))) return dir
		const up = path.dirname(dir)
		if (up === dir) return from
		dir = up
	}
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const root = projectRoot()
	return {
		root,
		host: '127.0.0.1',
		port: int(env['ORCH_PORT'], 4337),
		home: env['NESSY_ORCH_HOME'] ?? path.join(os.homedir(), '.nessy-orch'),
		nessyBin: env['NESSY_BIN'] ?? path.join(os.homedir(), '.local', 'bin', 'nessy'),
		nessyServeArgs: (env['NESSY_SERVE_ARGS'] ?? '').split(/\s+/).filter(Boolean),
		serveBasePort: int(env['SERVE_BASE_PORT'], 4360),
		maxSessionsPerSpace: int(env['MAX_SESSIONS'], 20),
		autoApprove: flag(env['ORCH_AUTO_APPROVE'], true),
		maxHops: int(env['ORCH_MAX_HOPS'], 8),
		rateLimitPerMinute: int(env['ORCH_RATE_LIMIT'], 30),
		serveIdleMin: nonNeg(env['ORCH_SERVE_IDLE_MIN'], DEFAULT_SERVE_IDLE_MIN),
		maxServes: nonNeg(env['ORCH_MAX_SERVES'], DEFAULT_MAX_SERVES),
		healthTimeoutMs: int(env['ORCH_HEALTH_TIMEOUT_MS'], 60000),
		uiDir: env['ORCH_UI_DIR'] ?? path.join(root, 'ui', 'dist'),
		seedRoles: flag(env['ORCH_SEED_ROLES'], true),
		rolesDir: path.join(root, 'roles'),
		cliPath: path.join(root, 'bin', 'nessy-orch'),
	}
}
