import { spawn, execSync, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Базовые команды спавна tclaude-агента и типы его NDJSON-событий (stream-json).
 * Только спавн и сборка аргументов; логика маппинга NDJSON → Envelope — в agent-port-tclaude.ts.
 * Флаги извлечены из спайка nessy-workspace/spike-tclaude/spike.js (команды run/isolate).
 */

// ---------- аргументы спавна ----------
export interface SpawnClaudeOptions {
	/** путь к бинарю tclaude */
	bin: string
	/** запрошенная модель (null/undefined — дефолт рантайма); --model работает только при спавне */
	model?: string | null
	/** идентификатор сессии для нового спавна (--session-id) */
	sessionId?: string | null
	/** поднять существующую сессию (--resume <session-id> вместо --session-id) */
	resume?: boolean
	/** режим разрешений (--permission-mode); безопасный дефолт — штатные подтверждения */
	permissionMode: string
	/** изолированный HOME агента (временный каталог) */
	homeDir: string
	/** рабочая директория агента (воркспейс) */
	cwd: string
	/** дополнительные переменные окружения */
	env?: NodeJS.ProcessEnv
	/** резолвер auth llm-прокси (в тестах — фейк); по умолчанию — из реального ~/.claude/settings.json */
	resolveAuth?: ResolveProxyAuth
}

export function buildTclaudeArgs(opts: SpawnClaudeOptions): string[] {
	// --verbose обязателен: без него `--print` + stream-json не эмитит события
	const args = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose']
	if (opts.resume && opts.sessionId) args.push('--resume', opts.sessionId)
	else if (opts.sessionId) args.push('--session-id', opts.sessionId)
	if (opts.model) args.push('--model', opts.model)
	args.push('--bare', '--strict-mcp-config', '--no-session-persistence', '--permission-mode', opts.permissionMode)
	return args
}

/** Спавн-функция, инъектируемая в адаптер (в unit-тестах — фейк). */
export type SpawnClaudeFn = (opts: SpawnClaudeOptions) => ChildProcess

// ---------- auth llm-прокси ----------
/** Auth llm-прокси, который tclaude берёт из apiKeyHelper (~/.claude/settings.json). */
export interface ProxyAuth {
	baseUrl?: string
	token?: string
}

/** Резолвер auth (вынесен для тестов). */
export type ResolveProxyAuth = () => ProxyAuth

/**
 * Auth из реального ~/.claude/settings.json (как это делает сам tclaude): apiKeyHelper — команда, дающая токен
 * в stdout. Нужен, потому что адаптер спавнит tclaude с изолированным HOME (чтобы не подхватывать пользовательские
 * хуки/плагины), где auth-конфига нет. Токен живёт только в env ребёнка — не логируется и не пишется в файлы.
 */
export const defaultResolveAuth: ResolveProxyAuth = () => {
	try {
		const home = process.env['HOME']
		if (!home) return {}
		const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')) as {
			apiKeyHelper?: unknown
			env?: Record<string, unknown>
		}
		const baseUrl = typeof settings.env?.['ANTHROPIC_BASE_URL'] === 'string' ? settings.env['ANTHROPIC_BASE_URL'] : process.env['ANTHROPIC_BASE_URL']
		let token: string | undefined
		if (typeof settings.apiKeyHelper === 'string') {
			// stderr не наследуем: токен не должен попасть в логи
			token = execSync(settings.apiKeyHelper, { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
		} else if (typeof settings.env?.['ANTHROPIC_AUTH_TOKEN'] === 'string') {
			token = settings.env['ANTHROPIC_AUTH_TOKEN']
		}
		return { ...(baseUrl ? { baseUrl } : {}), ...(token ? { token } : {}) }
	} catch {
		return {} // settings.json нет или apiKeyHelper упал — полагаемся на process.env (прежнее поведение)
	}
}

/** Окружение ребёнка: process.env + опции + изолированный HOME + auth llm-прокси (если нет в env). */
export function buildClaudeEnv(opts: SpawnClaudeOptions): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}), HOME: opts.homeDir }
	// изолированный HOME не содержит auth-конфига tclaude: подставляем токен llm-прокси из реального settings.json
	if (!env['ANTHROPIC_AUTH_TOKEN']) {
		const auth = (opts.resolveAuth ?? defaultResolveAuth)()
		if (auth.token) env['ANTHROPIC_AUTH_TOKEN'] = auth.token
		if (auth.baseUrl) env['ANTHROPIC_BASE_URL'] = auth.baseUrl
	}
	// агентский процесс не должен получить токен оператора (§3 «секреты в env детей»)
	delete env['NESSY_ORCH_TOKEN']
	return env
}

/** Реальный спавн: чистый HOME на агента, cwd — воркспейс агента, stdin открыт (mid-turn). */
export const spawnClaude: SpawnClaudeFn = opts => {
	return spawn(opts.bin, buildTclaudeArgs(opts), { env: buildClaudeEnv(opts), stdio: ['pipe', 'pipe', 'pipe'], cwd: opts.cwd })
}

// ---------- NDJSON-события tclaude (минимальный поднабор, нужный адаптеру) ----------
export interface TclaudeTextBlock {
	type: 'text'
	text: string
}

export interface TclaudeInitEvent {
	type: 'system'
	subtype: 'init'
	session_id: string
	model: string | null
	cwd: string
	/** mcp_servers/tools — не используются адаптером, но присутствуют в init */
	mcp_servers?: unknown[]
	tools?: unknown[]
}

export interface TclaudeAssistantEvent {
	type: 'assistant'
	message?: { content?: unknown[] }
}

export interface TclaudeResultEvent {
	type: 'result'
	subtype?: string
	result?: string
	total_cost_usd?: number
	num_turns?: number
	duration_ms?: number
	stop_reason?: string
	session_id?: string
	total_tokens?: number
}

export interface TclaudeErrorEvent {
	type: 'error'
	error?: string | { message?: string }
}

export type TclaudeEvent =
	TclaudeInitEvent | TclaudeAssistantEvent | TclaudeResultEvent | TclaudeErrorEvent | { type: string; subtype?: string; [k: string]: unknown }
