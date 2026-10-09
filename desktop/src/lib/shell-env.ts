/**
 * Окружение login shell пользователя. Приложение, запущенное из Finder, получает от launchd почти
 * пустое окружение (PATH=/usr/bin:/bin…, без прокси, токенов и переменных из ~/.zshrc), а nessy serve
 * без них не работает. Поэтому один раз при старте спрашиваем `$SHELL -ilc 'env -0'` (как shell-env /
 * fix-path) и вливаем результат в process.env — дочерние процессы получают окружение терминала.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

/** Переменные, которые из шелла не переносим: служебные шелла и самого Electron. */
const SKIP = new Set(['_', 'SHLVL', 'PWD', 'OLDPWD', 'PS1', 'PS2', 'TERM_SESSION_ID', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION'])
const skipped = (k: string): boolean => SKIP.has(k) || k.startsWith('ELECTRON_') || k.startsWith('__CF')

export const ENV_MARK = '__NESSY_ENV_7f3a__'

/** Login shell: $SHELL, если это существующий абсолютный путь, иначе /bin/zsh (дефолт macOS). */
export function userShell(env: NodeJS.ProcessEnv, exists: (p: string) => boolean = fs.existsSync): string {
	const sh = env['SHELL']
	return sh && path.isAbsolute(sh) && exists(sh) ? sh : '/bin/zsh'
}

/** Аргументы запуска: интерактивный login shell печатает окружение между метками. */
export function shellEnvArgs(): string[] {
	return ['-ilc', `printf '%s' '${ENV_MARK}'; command env -0; printf '%s' '${ENV_MARK}'`]
}

/** Окружение для самого запуска шелла: глушим автообновления и автозапуск tmux в rc-файлах. */
export function probeEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return { ...base, DISABLE_AUTO_UPDATE: 'true', ZSH_TMUX_AUTOSTART: 'false', ZSH_TMUX_AUTOSTARTED: 'true' }
}

/**
 * Разобрать вывод: всё между первой и последней меткой — записи `KEY=VALUE`, разделённые \0.
 * rc-файлы могут печатать что угодно до и после — это отбрасывается.
 */
export function parseEnvOutput(stdout: string): Record<string, string> {
	const start = stdout.indexOf(ENV_MARK)
	const end = stdout.lastIndexOf(ENV_MARK)
	if (start < 0 || end <= start) return {}
	const body = stdout.slice(start + ENV_MARK.length, end)
	const out: Record<string, string> = {}
	for (const entry of body.split('\0')) {
		const eq = entry.indexOf('=')
		if (eq <= 0) continue
		const key = entry.slice(0, eq)
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
		out[key] = entry.slice(eq + 1)
	}
	return out
}

/** Склеить PATH: сначала каталоги шелла, затем те из текущего, которых там нет. */
export function mergePath(shellPath: string | undefined, current: string | undefined): string | undefined {
	const parts: string[] = []
	for (const p of [...(shellPath ?? '').split(':'), ...(current ?? '').split(':')]) if (p && !parts.includes(p)) parts.push(p)
	return parts.length ? parts.join(':') : undefined
}

/**
 * Влить окружение шелла в текущее: значения шелла важнее (так работает терминал), служебные
 * переменные шелла и ELECTRON_* не переносим. Возвращает новый объект и список изменённых ключей.
 */
export function mergeEnv(current: NodeJS.ProcessEnv, shell: Record<string, string>): { env: NodeJS.ProcessEnv; changed: string[] } {
	const env: NodeJS.ProcessEnv = { ...current }
	const changed: string[] = []
	for (const [k, v] of Object.entries(shell)) {
		if (skipped(k)) continue
		const next = k === 'PATH' ? mergePath(v, current['PATH']) : v
		if (next === undefined || env[k] === next) continue
		env[k] = next
		changed.push(k)
	}
	return { env, changed }
}
