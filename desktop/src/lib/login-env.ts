/** Запуск login shell и слияние его окружения с process.env (логика разбора — в shell-env.ts). */
import { execFile } from 'node:child_process'
import { mergeEnv, parseEnvOutput, probeEnv, shellEnvArgs, userShell } from './shell-env'

export interface LoginEnvResult {
	shell: string
	/** изменённые переменные (только имена — значения могут быть секретами) */
	changed: string[]
	error: string | null
}

/** Получить окружение `$SHELL -ilc 'env -0'` (таймаут ~5 с) и влить в target. */
export function applyLoginEnv(target: NodeJS.ProcessEnv = process.env, timeoutMs = 5000): Promise<LoginEnvResult> {
	const shell = userShell(target)
	return new Promise(resolve => {
		if (process.platform === 'win32') {
			resolve({ shell, changed: [], error: 'не поддерживается на Windows' })
			return
		}
		execFile(shell, shellEnvArgs(), { env: probeEnv(target), timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
			const parsed = parseEnvOutput(stdout)
			if (Object.keys(parsed).length === 0) {
				resolve({ shell, changed: [], error: err ? err.message : 'шелл не вернул окружение' })
				return
			}
			const { env, changed } = mergeEnv(target, parsed)
			for (const k of changed) target[k] = env[k]
			// даже при ненулевом коде выхода rc-файлов окружение получено — используем его
			resolve({ shell, changed, error: null })
		})
	})
}
