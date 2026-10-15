import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Config } from './config.types'

const int = (v: string | undefined, d: number): number => {
	const n = parseInt(v ?? '', 10)
	return Number.isFinite(n) ? n : d
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
		maxSessionsPerSpace: int(env['MAX_SESSIONS'], 32),
		maxDepth: Math.max(0, int(env['ORCH_MAX_DEPTH'], 2)),
		maxActivePerSession: Math.max(1, int(env['ORCH_MAX_ACTIVE'], 12)),
		maxAgentsPerSession: Math.max(1, int(env['ORCH_MAX_AGENTS'], 40)),
		contextWindow: Math.max(1000, int(env['ORCH_CONTEXT_WINDOW'], 128_000)),
		agentTtlMs: Math.max(0, int(env['ORCH_AGENT_TTL_MIN'], 360)) * 60_000,
		idleCloseMs: Math.max(0, int(env['ORCH_IDLE_CLOSE_SEC'], 120)) * 1000,
		autoApprove: flag(env['ORCH_AUTO_APPROVE'], true),
		maxHops: int(env['ORCH_MAX_HOPS'], 8),
		rateLimitPerMinute: int(env['ORCH_RATE_LIMIT'], 30),
		healthTimeoutMs: int(env['ORCH_HEALTH_TIMEOUT_MS'], 60000),
		warmSessions: Math.max(0, int(env['ORCH_WARM_SESSIONS'], 2)),
		seedRoles: flag(env['ORCH_SEED_ROLES'], true),
		rolesDir: path.join(root, 'roles'),
		cliPath: path.join(root, 'bin', 'nessy-orch'),
	}
}
