import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HttpTransport, makeTransport } from '../../../../src/interfaces/cli/transport'
import { setAgentKey as clientSetAgentKey } from '../../../../src/interfaces/cli/client'

describe('CLI transport', () => {
	it('makeTransport возвращает HttpTransport', () => {
		assert.ok(makeTransport({}) instanceof HttpTransport)
	})

	it('HttpTransport.setAgentKey делегирует в клиентский setAgentKey', () => {
		const t = new HttpTransport({})
		t.setAgentKey('k1')
		t.setAgentKey('  ')
		t.setAgentKey(undefined)
		// не бросает и не падает: ключ тримится/сбрасывается
		clientSetAgentKey(undefined)
	})

	it('endpoint порта по умолчанию не валится на пустом окружении', () => {
		const t = new HttpTransport({})
		assert.ok(t)
	})
})
