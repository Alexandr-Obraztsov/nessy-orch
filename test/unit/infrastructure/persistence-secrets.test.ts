/** Секреты в покое (B2): файлы ORCH_HOME — 0o600, каталоги — 0o700. Проверка на реальном tmp. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { appendJsonl, writeAtomic } from '../../../src/infrastructure/persistence/jsonl'
import { FileStore } from '../../../src/infrastructure/persistence/file-store'

/** Нет доступа у группы/остальных (секурити-свойство: файл/каталог только для владельца). */
const noGroupOther = (p: string): boolean => (fs.statSync(p).mode & 0o077) === 0

const tmpHome = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-orch-secrets-'))

describe('секреты в покое: файлы 0o600, каталоги 0o700', () => {
	it('writeAtomic создаёт файл только для владельца (0o600)', () => {
		const home = tmpHome()
		try {
			const file = path.join(home, 'state.json')
			writeAtomic(file, '{}')
			assert.ok(noGroupOther(file), 'state.json не должен быть доступен группе/остальным')
			assert.ok((fs.statSync(file).mode & 0o600) === 0o600, 'владелец читает и пишет')
		} finally {
			fs.rmSync(home, { recursive: true, force: true })
		}
	})

	it('appendJsonl при создании файла ставит 0o600 (новый messages.jsonl)', () => {
		const home = tmpHome()
		try {
			const file = path.join(home, 'messages.jsonl')
			appendJsonl(file, { kind: 'reply', text: 'x' })
			assert.ok(noGroupOther(file), 'messages.jsonl не должен быть доступен группе/остальным')
			assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 1)
		} finally {
			fs.rmSync(home, { recursive: true, force: true })
		}
	})

	it('FileStore создаёт каталоги agents/sources/logs с 0o700', () => {
		const home = tmpHome()
		try {
			const store = new FileStore(home)
			for (const dir of [store.agentsDir, store.sourcesDir, store.logsDir]) {
				assert.ok(fs.existsSync(dir), `${dir} должен существовать`)
				assert.ok(noGroupOther(dir), `${dir} не должен быть доступен группе/остальным`)
			}
		} finally {
			fs.rmSync(home, { recursive: true, force: true })
		}
	})
})
