/**
 * Переменные окружения из файла `.env` (без зависимостей). Нужны, чтобы секреты (например NESSY_SERVER_TOKEN)
 * не держать в терминале: оркестратор читает их при старте и передаёт дочерним `nessy serve`.
 *
 * Формат: `KEY=value`, `export KEY=value`, значения в одинарных или двойных кавычках, комментарии `#`.
 * Переменные, уже заданные в окружении процесса, не перезаписываются.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { projectRoot } from './load-config'

/** Разобрать текст .env в пары ключ → значение. */
export function parseEnvFile(text: string): Record<string, string> {
	const out: Record<string, string> = {}
	for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) continue
		const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
		if (!m?.[1]) continue
		let v = m[2] ?? ''
		if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
			const dq = v.startsWith('"')
			v = v.slice(1, -1)
			if (dq) v = v.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
		} else {
			v = v.replace(/\s+#.*$/, '').trim() // комментарий после значения без кавычек
		}
		out[m[1]] = v
	}
	return out
}

/** Файлы .env по порядку приоритета: домашний каталог оркестратора, затем корень проекта. */
export function envFilePaths(env: NodeJS.ProcessEnv = process.env): string[] {
	const home = env['NESSY_ORCH_HOME'] ?? path.join(os.homedir(), '.nessy-orch')
	return [path.join(home, '.env'), path.join(projectRoot(), '.env')]
}

/** Загрузить .env-файлы в окружение (не перезаписывая заданное). Возвращает пути прочитанных файлов. */
export function loadEnvFiles(files: string[] = envFilePaths(), env: NodeJS.ProcessEnv = process.env): string[] {
	const loaded: string[] = []
	for (const f of files) {
		let text: string
		try {
			text = fs.readFileSync(f, 'utf8')
		} catch {
			continue
		}
		for (const [k, v] of Object.entries(parseEnvFile(text))) if (env[k] === undefined) env[k] = v
		loaded.push(f)
	}
	return loaded
}
