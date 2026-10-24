/**
 * Модель агента: события порта о модели (`model.switched`, `model.switch_failed`, подтверждение из `system/init`) → состояние агента.
 * Выделено из agent-events.ts по единой ответственности; состояние агента передаётся параметром (AgentState).
 */
import type { Envelope } from '../agent-port'
import { isObject } from '../../lib/json'
import type { AgentState } from './agent.types'

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/**
 * Применить событие порта о модели. Возвращает true, если событие модельное и обработано (дальше его разбирать не нужно).
 *  - session.meta без displayName с data.model — адаптер подтвердил фактическую модель;
 *  - model.switched — смена принята: запрошенная и фактическая совпадают (у tclaude следом придёт подтверждение из init);
 *  - model.switch_failed — рантайм подставил другую модель: запрошенная — expected, фактическая — actual (если известна).
 */
export function applyModelEvent(a: AgentState, envelope: Envelope): boolean {
	const d = envelope.data
	if (envelope.type === 'session.meta') {
		if (!isObject(d) || d['displayName'] !== undefined) return false
		const inner = d['data']
		const actual = isObject(inner) ? str(inner['model']) : null
		if (actual === null) return false
		touchModel(a, envelope, () => setActual(a, actual))
		return true
	}
	if (envelope.type === 'model.switched') {
		const model = isObject(d) ? str(d['model']) : null
		if (model === null) return true
		touchModel(a, envelope, () => {
			a.modelRequested = model
			setActual(a, model)
		})
		return true
	}
	if (envelope.type === 'model.switch_failed') {
		const expected = isObject(d) ? str(d['expected']) : null
		const actual = isObject(d) ? str(d['actual']) : null
		const message = (isObject(d) ? str(d['message']) : null) ?? 'рантайм запустился на другой модели'
		touchModel(a, envelope, () => {
			if (expected !== null) a.modelRequested = expected
			if (actual !== null) setActual(a, actual)
			a.addSystem(message, 'error')
		})
		return true
	}
	return false
}

function setActual(a: AgentState, model: string): void {
	a.modelActual = model
}

function touchModel(a: AgentState, envelope: Envelope, apply: () => void): void {
	a.lastEventId = envelope.seq
	apply()
	a.publishNode()
	a.deps.callbacks.saveSoon()
}
