/**
 * AgentJournal — журнал событий одного агента: присваивает seq, пишет в хранилище и шину,
 * собирает стримящийся текст в блоки (run) и ведёт записи вызовов инструментов по toolId.
 */
import type { AgentEvent, ToolEvent } from '../../../shared/types'
import type { Hub } from '../hub'
import type { Clock, SessionEvent, StorePort } from '../ports'
import type { LiveRun, NewAgentEvent } from './agent.types'
import { clip } from '../../lib/text'

const MAX_TOOL_OUT = 4000

export class AgentJournal {
	private run: LiveRun | null = null
	private readonly tools = new Map<string, ToolEvent>()

	constructor(
		private readonly agentId: string,
		private readonly deps: { hub: Hub; store: StorePort; clock: Clock },
		public evSeq = 0,
	) {}

	add(fields: NewAgentEvent): AgentEvent {
		const rec = { seq: ++this.evSeq, ts: this.deps.clock.now(), ...fields }
		this.write(rec)
		return rec
	}

	private write(rec: AgentEvent): void {
		this.deps.store.appendEvent(this.agentId, rec)
		this.deps.hub.publish({ t: 'event', agentId: this.agentId, event: rec })
	}

	// ---------- стриминг текста ----------
	/** Добавить чанк; новый блок начинается при смене вида или messageId. */
	chunk(kind: 'text' | 'thought', delta: string, messageId: string | null): void {
		if (!this.run || this.run.kind !== kind || (messageId !== null && this.run.messageId !== null && this.run.messageId !== messageId)) {
			this.flushRun()
			this.run = { kind, seq: ++this.evSeq, ts: this.deps.clock.now(), text: '', messageId }
		}
		const run = this.run
		run.messageId ??= messageId
		run.text += delta
		this.deps.hub.publish({
			t: 'chunk',
			agentId: this.agentId,
			chunk: { seq: run.seq, ts: run.ts, kind, delta, len: run.text.length },
		})
	}

	/** Закрыть текущий блок текста: записать его целиком как событие. */
	flushRun(): void {
		const r = this.run
		if (!r) return
		this.run = null
		if (r.text) this.write({ seq: r.seq, ts: r.ts, kind: r.kind, text: r.text })
	}

	/** Незавершённый блок текста (для снапшота при подключении UI). */
	liveRun(): LiveRun | null {
		return this.run ? { ...this.run } : null
	}

	// ---------- инструменты ----------
	hasTool(toolId: string): boolean {
		return this.tools.has(toolId)
	}

	/**
	 * Создать или обновить запись инструмента. Обновление перезаписывает запись с тем же seq
	 * (при чтении истории позднейшая запись с тем же seq побеждает). Возвращает [запись, создана ли].
	 */
	upsertTool(ev: Extract<SessionEvent, { kind: 'tool' }>): [ToolEvent, boolean] {
		const output = ev.output ? clip(ev.output, MAX_TOOL_OUT) : undefined
		const prev = this.tools.get(ev.toolId)
		if (!prev) {
			this.flushRun()
			const fields: NewAgentEvent = {
				kind: 'tool',
				toolId: ev.toolId,
				name: ev.name,
				title: clip(ev.title, 200),
				input: ev.input,
				status: ev.status,
			}
			if (output !== undefined) fields.output = output
			const rec = this.add(fields) as ToolEvent
			this.tools.set(ev.toolId, rec)
			return [rec, true]
		}
		const next: ToolEvent = {
			...prev,
			name: ev.name || prev.name,
			title: ev.title ? clip(ev.title, 200) : prev.title,
			input: Object.keys(ev.input).length ? ev.input : prev.input,
			status: ev.status,
		}
		if (output !== undefined) next.output = output
		this.tools.set(ev.toolId, next)
		this.write(next)
		return [next, false]
	}

	/** Завершить незакрытые инструменты статусом failed (ход прерван или упал). */
	failOpenTools(): void {
		for (const t of this.tools.values())
			if (t.status === 'pending' || t.status === 'in_progress') {
				const next: ToolEvent = { ...t, status: 'failed' }
				this.tools.set(t.toolId, next)
				this.write(next)
			}
	}

	resetTools(): void {
		this.tools.clear()
	}
}
