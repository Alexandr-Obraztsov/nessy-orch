import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkSender, type SenderCaller } from '../../../src/application/authorize-sender'
import { Registry } from '../../../src/application/registry'
import { AppError } from '../../../src/domain/errors'
import type { Agent } from '../../../src/application/agent/agent'

const YOU = 'you'
const USER = 'user'

/** Реестр с одним агентом `a-1` с заданным ключом. */
function registryWith(key: string): Registry {
	const r = new Registry()
	r.agents.set('a-1', { id: 'a-1', name: 'a-1', title: null, key } as unknown as Agent)
	return r
}

const agentCaller = (agentKey: string | null): SenderCaller => ({ operator: false, agentKey })
const opCaller: SenderCaller = { operator: true, agentKey: null }

function expect403(fn: () => void, code: string): void {
	assert.throws(fn, (e: unknown) => e instanceof AppError && e.status === 403 && e.code === code)
}

describe('checkSender — оператор и ключи агентов', () => {
	it('оператор может всё: любой from/ключ', () => {
		checkSender(registryWith('secret'), undefined, opCaller)
		checkSender(registryWith('secret'), 'you', opCaller)
		checkSender(registryWith('secret'), 'a-1', opCaller)
	})

	it('без токена и без from — operator_required', () => {
		expect403(() => checkSender(registryWith('secret'), undefined, agentCaller('k')), 'operator_required')
	})

	it('без токена от имени you — operator_required', () => {
		expect403(() => checkSender(registryWith('secret'), YOU, agentCaller('k')), 'operator_required')
	})

	it('без токена от имени user — operator_required', () => {
		expect403(() => checkSender(registryWith('secret'), USER, agentCaller('k')), 'operator_required')
	})

	it('агент с верным ключом — проходит', () => {
		checkSender(registryWith('secret-key'), 'a-1', agentCaller('secret-key'))
	})

	it('агент с пустым ключом в реестре — bad_agent_key', () => {
		expect403(() => checkSender(registryWith(''), 'a-1', agentCaller('x')), 'bad_agent_key')
	})

	it('ключ другой длины — bad_agent_key', () => {
		expect403(() => checkSender(registryWith('secret-key'), 'a-1', agentCaller('short')), 'bad_agent_key')
	})

	it('ключ той же длины, но неверный — bad_agent_key', () => {
		expect403(() => checkSender(registryWith('secret-key'), 'a-1', agentCaller('secret-zzz')), 'bad_agent_key')
	})

	it('пустой caller-ключ против непустого ключа агента — bad_agent_key', () => {
		expect403(() => checkSender(registryWith('secret-key'), 'a-1', agentCaller('')), 'bad_agent_key')
	})

	it('неизвестный from — проброс ошибки реестра (no_agent)', () => {
		assert.throws(
			() => checkSender(registryWith('secret'), 'ghost', agentCaller('k')),
			(e: unknown) => e instanceof AppError && e.code === 'no_agent',
		)
	})
})
