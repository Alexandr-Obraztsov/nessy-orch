/**
 * Внешние сценарии FakeAgentPort: файл `$NESSY_ORCH_HOME/fake-scenarios.json` — объект {«подстрока промпта»: сценарий}.
 * Сценарий — строка с командой «#…» либо массив операций (так тесты «Фона» задают ответы агентов-сборщиков и т. п.):
 *   {thought}, {text}, {plan: {steps, statuses}}, {tool: {name, title, input, output}},
 *   {ask: «заголовок»} (запрос разрешения; после «Разрешить» сценарий идёт дальше, иначе — остановка),
 *   {hang: «заголовок»} (инструмент «в работе», ход не завершается до отмены).
 * Развитие одноимённого механизма прежнего fake-nessy.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { PortEvent } from '../../src/application/agent-port'
import type { FakeSession } from './fake-agent-port-scenarios'

export type Op = Record<string, unknown>

/** Сценарий для промпта: первое совпадение по подстроке; нет файла или он битый — null (обычное эхо). */
export function lookupScenario(text: string): { key: string; scenario: string | Op[] } | null {
	const home = process.env['NESSY_ORCH_HOME']
	if (!home) return null
	try {
		const all = JSON.parse(fs.readFileSync(path.join(home, 'fake-scenarios.json'), 'utf8')) as Record<string, string | Op[]>
		for (const [key, scenario] of Object.entries(all)) if (text.includes(key)) return { key, scenario }
	} catch {
		/* файла нет или он битый */
	}
	return null
}

const opStr = (v: unknown): string => (typeof v === 'string' ? v : '')
const opObj = (v: unknown): Op => (typeof v === 'object' && v !== null ? (v as Op) : {})
let opSeq = 0

/** Играет массив операций; на {ask} ждёт голосования и продолжает со следующей операции. */
export function playOps(emit: (s: FakeSession, port: PortEvent) => void, s: FakeSession, ops: readonly Op[], from: number, finish: () => void): void {
	for (let i = from; i < ops.length; i++) {
		const op = ops[i] ?? {}
		const id = `x${++opSeq}`
		if (typeof op['thought'] === 'string') emit(s, { type: 'thought.delta', data: { messageId: id, text: op['thought'] } })
		else if (typeof op['text'] === 'string') emit(s, { type: 'message.delta', data: { messageId: id, text: op['text'] } })
		else if (op['plan']) {
			const p = opObj(op['plan'])
			const steps = Array.isArray(p['steps']) ? p['steps'].map(String) : []
			const statuses = Array.isArray(p['statuses']) ? p['statuses'].map(String) : []
			emit(s, { type: 'plan.updated', data: { entries: steps.map((content, k) => ({ content, status: statuses[k] ?? 'pending' })) } })
		} else if (op['tool']) {
			const t = opObj(op['tool'])
			const data = { toolId: id, name: opStr(t['name']), title: opStr(t['title']), input: opObj(t['input']) }
			emit(s, { type: 'tool_call.started', data })
			emit(s, { type: 'tool_call.completed', data: { ...data, status: 'completed', output: opStr(t['output']) } })
		} else if (typeof op['hang'] === 'string') {
			// инструмент «в работе», ход не завершается: держим его открытым до promptCancel
			emit(s, { type: 'tool_call.started', data: { toolId: id, name: 'shell', title: op['hang'], input: {} } })
			s.hang = true
			return
		} else if (typeof op['ask'] === 'string') {
			const title = op['ask']
			const requestId = `perm_${id}`
			s.permissions.set(requestId, approved => {
				if (approved) playOps(emit, s, ops, i + 1, finish)
				else {
					emit(s, { type: 'message.delta', data: { messageId: id, text: 'Пользователь отклонил команду — останавливаюсь.' } })
					finish()
				}
			})
			emit(s, {
				type: 'permission.requested',
				data: {
					requestId,
					title,
					options: [
						{ optionId: 'proceed_once', kind: 'allow_once', name: 'Разрешить' },
						{ optionId: 'cancel', kind: 'reject_once', name: 'Отклонить' },
					],
				},
			})
			return
		}
	}
	finish()
}
