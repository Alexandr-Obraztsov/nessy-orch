/**
 * События сессии: Envelope → SessionEvent → обновление состояния агента (текст, инструменты, разрешения, метрики).
 * Выделено из agent.ts по единой ответственности — «события/usage»; состояние агента передаётся параметром (AgentState).
 */
import { portEventToSessionEvent } from '../agent-port'
import type { Envelope, PortEvent } from '../agent-port'
import type { SessionEvent } from '../ports'
import { coercePlanEntries } from '../../domain/plan'
import { pickPermissionOption } from '../../domain/permission'
import { urlsInInput } from '../../domain/sources'
import { clip } from '../../lib/text'
import { detach, ensureAttached } from './agent-connection'
import { finishTurn, sendCancel } from './agent-turn'
import type { AgentState, CurrentTurn } from './agent.types'

/** Событие порта: Envelope → SessionEvent (нормализация §3), seq конверта идёт как eventId (для lastEventId). */
export function processPortEvent(a: AgentState, envelope: Envelope): void {
	// конверт несёт событие порта, разбитое на type + data; порт гарантирует контрактную форму
	const portEvent: { type: string; data: unknown } = { type: envelope.type, data: envelope.data }
	const ev = portEventToSessionEvent(portEvent as PortEvent)
	if (ev) onSessionEvent(a, ev, envelope.seq)
}

function onSessionEvent(a: AgentState, ev: SessionEvent, eventId: number | null): void {
	if (eventId !== null) {
		a.lastEventId = eventId
		a.deps.callbacks.saveSoon()
	}
	// после неподтверждённой отмены содержимое старого промпта не должно попасть в новый ход
	if (
		a.staleEvents &&
		(ev.kind === 'text' || ev.kind === 'thought' || ev.kind === 'tool' || ev.kind === 'turn_error' || ev.kind === 'permission' || ev.kind === 'plan')
	)
		return
	switch (ev.kind) {
		case 'text':
		case 'thought':
			if (!a.current) return // реплей вне хода игнорируем
			a.touch()
			if (ev.kind === 'text') appendText(a, ev.text, ev.messageId)
			a.journal.chunk(ev.kind, ev.text, ev.messageId)
			return
		case 'tool':
			onTool(a, ev)
			return
		case 'turn_error':
			if (a.current) a.current.error = ev.message
			else a.addSystem('ошибка nessy: ' + ev.message, 'error')
			return
		case 'meta':
			a.displayName = ev.displayName
			a.publishNode()
			return
		case 'permission':
			onPermission(a, ev)
			return
		case 'turn_complete':
			if (!a.current || a.isDonePrompt(ev.promptId)) return
			if (a.current.promptId && ev.promptId && a.current.promptId !== ev.promptId) return // устаревший реплей
			finishTurn(a, { stopReason: ev.stopReason })
			return
		case 'cancelled':
			if (!a.current || a.isDonePrompt(ev.promptId)) return
			if (a.current.promptId && ev.promptId && a.current.promptId !== ev.promptId) return
			finishTurn(a, { stopReason: 'cancelled' })
			return
		case 'plan':
			if (!a.current) return // реплей вне хода игнорируем: план мог смениться через CLI
			a.setPlan(coercePlanEntries(ev.entries), 'acp')
			return
		case 'followup':
			return // подсказки следующего вопроса оркестратору не нужны
		case 'injected': {
			// nessy забрал сообщения mid-turn: модель их увидела (подтверждаем по порядку)
			let n = ev.count
			for (const i of a.current?.injected ?? []) {
				if (n > 0 && !i.confirmed) {
					i.confirmed = true
					n--
					// в чат — когда модель сообщение действительно увидела
					a.journal.add({ kind: 'user', from: i.msg.from, msgId: i.msg.id, text: i.msg.text })
					a.touch()
				}
			}
			return
		}
		case 'died':
			// сессии больше нет: следующее сообщение создаст новую (контекст сброшен)
			detach(a)
			a.resume = false
			a.addSystem('сессия nessy завершилась: ' + ev.reason, 'error')
			if (a.current) finishTurn(a, { error: ev.reason })
			else a.setStatus('error', ev.reason)
			return
		case 'resync':
			// пропущенные события могли включать конец хода: ход закрываем с ошибкой (а в nessy отменяем), сессию подписываем заново
			detach(a)
			a.resume = true
			if (a.current) {
				void sendCancel(a)
				finishTurn(a, { error: 'события nessy потеряны (переполнение кольца) — ход прерван' })
			}
			void ensureAttached(a).catch(() => undefined)
			return
		case 'evicted':
			detach(a)
			a.resume = true
			void ensureAttached(a).catch(() => undefined)
			return
		case 'usage':
			// расход контекста из события порта (вместо опроса /stats): used — занято в окне, size — окно модели
			a.ctxUsed = ev.used
			a.ctxSize = ev.size
			if (ev.used > 0) a.stats = { ...a.stats, tokens: { input: 0, output: 0, cached: 0, total: ev.used }, ...a.contextMetric() }
			a.publishNode()
			return
		case 'closed':
			// сессия закрыта рантаймом: подписка мертва, следующее сообщение создаст новую сессию
			detach(a)
			a.resume = true
			return
	}
}

function onTool(a: AgentState, ev: Extract<SessionEvent, { kind: 'tool' }>): void {
	// обновление инструмента, который мы не видели, вне хода — это реплей: пропускаем
	if (!a.current && !a.journal.hasTool(ev.toolId)) return
	const [rec, created] = a.journal.upsertTool(ev)
	a.touch()
	const urls = urlsInInput(rec.input)
	if (urls.length) a.deps.callbacks.onToolUrls(a, urls)
	if (created) {
		a.turnSteps++
		a.lastTool = { name: rec.name, title: clip(rec.title || JSON.stringify(rec.input), 120) }
		if (a.current) {
			a.current.textBreak = true
			checkPlan(a, a.current)
		}
		a.publishNode()
	}
}

/** Текст хода по блокам: новый блок — при смене messageId или после вызова инструмента. */
function appendText(a: AgentState, delta: string, messageId: string | null): void {
	const cur = a.current
	if (!cur) return
	const fresh = !cur.texts.length || cur.textBreak || (messageId !== null && cur.textMsgId !== null && messageId !== cur.textMsgId)
	if (fresh) cur.texts.push(delta)
	else cur.texts.push((cur.texts.pop() ?? '') + delta)
	cur.textBreak = false
	cur.textMsgId = messageId ?? cur.textMsgId
}

/** После 3+ инструментов без плана в этом ходе — одно предупреждение в ленте агента. */
function checkPlan(a: AgentState, cur: CurrentTurn): void {
	if (cur.planned || cur.planWarned || a.turnSteps < 3) return
	cur.planWarned = true
	a.addSystem('агент не опубликовал план')
}

function onPermission(a: AgentState, ev: Extract<SessionEvent, { kind: 'permission' }>): void {
	const title = clip(ev.title, 200)
	if (a.deps.autoApprove) {
		const client = a.deps.callbacks.getSpace(a.space)?.client
		const optionId = pickPermissionOption(ev.options, true)
		if (client && a.nessyId) void client.permissionVote(a.nessyId, ev.requestId, optionId).catch(() => undefined)
		a.journal.add({ kind: 'permission', requestId: ev.requestId, title, resolved: true, approved: true, auto: true })
		a.touch()
		return
	}
	a.pending.set(ev.requestId, { requestId: ev.requestId, title, options: ev.options })
	a.journal.add({ kind: 'permission', requestId: ev.requestId, title, resolved: false })
	a.touch()
	a.publishNode()
}

export async function resolvePermission(a: AgentState, requestId: string, approve: boolean): Promise<boolean> {
	const p = a.pending.get(requestId)
	const client = a.deps.callbacks.getSpace(a.space)?.client
	if (!p || !client || !a.nessyId) return false
	await client.permissionVote(a.nessyId, requestId, pickPermissionOption(p.options, approve))
	a.pending.delete(requestId)
	a.journal.add({ kind: 'permission', requestId, title: p.title, resolved: true, approved: approve, auto: false })
	a.touch()
	a.publishNode()
	return true
}
