/** Авто-повтор поручения после ошибки хода: 2 повтора с паузой, подсказка модели, ответ с ошибкой только по исчерпании. */
import assert from 'node:assert/strict'
import * as os from 'node:os'
import { describe, it } from 'node:test'
import type { Message } from '../../../shared/types'
import { Orchestrator } from '../../../src/application/orchestrator'
import type { OrchSettings } from '../../../src/application/settings.types'
import { FakeAgentPort, FakeSpace, MemoryStore } from '../../support/memory-store'
import { until } from '../../support/wait'

function setup(extra: Partial<OrchSettings> = {}) {
	const gw = new FakeAgentPort({ autoRespond: false })
	const store = new MemoryStore()
	const orch = new Orchestrator({
		settings: {
			home: os.tmpdir(),
			autoApprove: true,
			maxHops: 8,
			rateLimitPerMinute: 30,
			cliPath: 'nessy-orch',
			idleCloseMs: 0,
			turnRetries: 2,
			turnRetryBaseMs: 10,
			...extra,
		},
		store,
		spaceFactory: init => new FakeSpace(init.name, init.path, gw),
	})
	orch.addSpace({ path: os.tmpdir(), name: 'main' })
	const replies = (): Message[] => store.messages.filter(m => m.kind === 'reply' && m.to === 'you')
	return { orch, gw, store, replies }
}
const fail = (id: string): Parameters<FakeAgentPort['emit']>[0][] => [
	{ kind: 'turn_error', message: 'модель перегружена', retryable: true, code: 529 },
	{ kind: 'turn_complete', stopReason: 'end_turn', promptId: id },
]

describe('авто-повтор после ошибки хода', () => {
	it('ошибка → повтор с пометкой в промпте → успех: ответ один, без ошибки', async () => {
		const { orch, gw, replies } = setup()
		await orch.spawn({ space: 'main', name: 'w', prompt: 'сделай X' })
		await until(() => gw.prompts.length === 1, 2000, 'первый промпт')
		gw.emit(...fail('p-1'))
		await until(() => gw.prompts.length === 2, 2000, 'повтор')
		assert.match(gw.prompts[1] ?? '', /оборвалась ошибкой: «модель перегружена»/)
		assert.match(gw.prompts[1] ?? '', /сделай X/)
		assert.equal(replies().length, 0, 'пока идут повторы, ответа с ошибкой нет')
		gw.emit({ kind: 'text', text: 'готово', messageId: 'm' }, { kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-2' })
		await until(() => replies().length === 1, 2000, 'ответ')
		assert.equal(replies()[0]?.failed, undefined)
		assert.equal(replies()[0]?.text, 'готово')
		assert.equal(orch.getAgent('w').status, 'idle')
	})

	it('два повтора не помогли: после третьей ошибки — ответ с ошибкой, агент в error', async () => {
		const { orch, gw, replies } = setup()
		await orch.spawn({ space: 'main', name: 'w', prompt: 'сделай X' })
		await until(() => gw.prompts.length === 1, 2000, 'первый промпт')
		gw.emit(...fail('p-1'))
		await until(() => gw.prompts.length === 2, 2000, 'повтор 1')
		gw.emit(...fail('p-2'))
		await until(() => gw.prompts.length === 3, 2000, 'повтор 2')
		gw.emit(...fail('p-3'))
		await until(() => replies().length === 1, 2000, 'ответ с ошибкой')
		assert.equal(gw.prompts.length, 3, 'четвёртого промпта нет')
		assert.match(replies()[0]?.failed ?? '', /модель перегружена/)
		assert.equal(orch.getAgent('w').status, 'error')
	})

	it('нет соединения с nessy при запуске: поручение повторяется, после восстановления выполняется без ошибки', async () => {
		const { orch, gw, replies } = setup()
		gw.failCreate = 2
		await orch.spawn({ space: 'main', name: 'w', prompt: 'сделай X' }).catch(() => undefined)
		await until(() => gw.prompts.length === 1, 3000, 'промпт после повторов')
		assert.equal(gw.failCreate, 0)
		gw.emit({ kind: 'text', text: 'ок', messageId: 'm' }, { kind: 'turn_complete', stopReason: 'end_turn', promptId: 'p-1' })
		await until(() => replies().length === 1, 2000, 'ответ')
		assert.equal(replies()[0]?.failed, undefined)
	})

	it('нет соединения всё время: после двух повторов ответ с ошибкой', async () => {
		const { orch, gw, replies } = setup()
		gw.failCreate = 10
		await orch.spawn({ space: 'main', name: 'w', prompt: 'сделай X' }).catch(() => undefined)
		await until(() => replies().length === 1, 3000, 'ответ с ошибкой')
		assert.match(replies()[0]?.failed ?? '', /nessy недоступен/)
		assert.equal(gw.failCreate, 10 - 3, 'попыток три: исходная и два повтора')
	})

	it('turnRetries=0 — как раньше: сразу ответ с ошибкой', async () => {
		const { orch, gw, replies } = setup({ turnRetries: 0 })
		await orch.spawn({ space: 'main', name: 'w', prompt: 'сделай X' })
		await until(() => gw.prompts.length === 1, 2000, 'промпт')
		gw.emit(...fail('p-1'))
		await until(() => replies().length === 1, 2000, 'ответ')
		assert.equal(gw.prompts.length, 1)
	})

	it('отмена во время паузы: повтора нет, агент свободен; ждущему --wait приходит ответ об отмене', async () => {
		const { orch, gw } = setup({ turnRetryBaseMs: 400 })
		await orch.spawn({ space: 'main', name: 'w', prompt: 'сделай X' })
		await until(() => gw.prompts.length === 1, 2000, 'промпт')
		gw.emit(...fail('p-1'))
		await until(() => orch.getAgent('w').queued === 1, 1000, 'поручение ждёт повтора')
		assert.equal(orch.getAgent('w').status, 'working', 'агент считается работающим, пока ждёт повтора')
		await orch.cancelAgent('w')
		await new Promise(r => setTimeout(r, 600))
		assert.equal(gw.prompts.length, 1, 'повтора после отмены нет')
		assert.equal(orch.getAgent('w').status, 'idle')
	})

	it('ход, отменённый пользователем, не повторяется', async () => {
		const { orch, gw, replies } = setup()
		await orch.spawn({ space: 'main', name: 'w', prompt: 'сделай X' })
		await until(() => gw.prompts.length === 1, 2000, 'промпт')
		await orch.cancelAgent('w')
		gw.emit({ kind: 'cancelled', promptId: 'p-1' })
		await until(() => replies().length === 1, 2000, 'ответ об отмене')
		await new Promise(r => setTimeout(r, 100))
		assert.equal(gw.prompts.length, 1)
	})
})
