/**
 * Токен оператора: общий секрет приложения и главного агента (его терминал получает его в NESSY_ORCH_TOKEN). Лежит в <home>/token (0600),
 * создаётся при первом старте. Агентам nessy он не передаётся (их окружение — окружение демона nessy serve, а не терминала),
 * поэтому без него они не могут выдать себя за оператора: им остаются команды от своего имени по ключу из вводной.
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

export function ensureToken(home: string): string {
	const file = path.join(home, 'token')
	try {
		const t = fs.readFileSync(file, 'utf8').trim()
		if (t.length >= 32) return t
	} catch {
		/* файла ещё нет */
	}
	fs.mkdirSync(home, { recursive: true })
	fs.chmodSync(home, 0o700) // секреты в покое: домашний каталог ORCH только для владельца (§3)
	const token = crypto.randomBytes(24).toString('hex')
	fs.writeFileSync(file, token + '\n', { mode: 0o600 })
	fs.chmodSync(file, 0o600)
	return token
}
