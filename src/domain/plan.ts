/**
 * План агента (чистые функции): проверка записей, разбор чек-листа из аргументов CLI и правило сброса.
 *
 * План — список шагов со статусами; каждое обновление заменяет его целиком (как ACP `plan`).
 * Правило сброса: новое сообщение от оператора (you), которое начинает ход, когда очереди нет,
 * а прежний план выполнен целиком, — это новая задача: план сбрасывается. Иначе (уточнение,
 * план не доделан, в очереди есть работа) план сохраняется.
 */
import type { AgentPlan, PlanEntry, PlanStatus } from '../../shared/types'
import { isObject } from '../lib/json'
import { AppError } from './errors'

export const PLAN_MAX_ENTRIES = 30
export const PLAN_ENTRY_MAX = 300

const STATUSES: readonly PlanStatus[] = ['pending', 'in_progress', 'completed']

export function isPlanStatus(v: unknown): v is PlanStatus {
	return typeof v === 'string' && (STATUSES as readonly string[]).includes(v)
}

const bad = (text: string): AppError => new AppError(400, 'bad_plan', text)

/** Строгая проверка записей плана из запроса: 1..30 записей, content 1..300 символов (после trim), известный статус. */
export function validatePlanEntries(raw: unknown): PlanEntry[] {
	if (!Array.isArray(raw)) throw bad('entries — массив записей плана')
	if (raw.length < 1 || raw.length > PLAN_MAX_ENTRIES) throw bad(`в плане должно быть от 1 до ${PLAN_MAX_ENTRIES} записей`)
	return raw.map((e: unknown, i): PlanEntry => {
		if (!isObject(e)) throw bad(`запись ${i + 1}: ожидается объект {content, status}`)
		const content = e['content']
		const status = e['status']
		if (typeof content !== 'string') throw bad(`запись ${i + 1}: content — строка`)
		const text = content.trim()
		if (!text || text.length > PLAN_ENTRY_MAX) throw bad(`запись ${i + 1}: content — от 1 до ${PLAN_ENTRY_MAX} символов`)
		if (!isPlanStatus(status)) throw bad(`запись ${i + 1}: status — pending | in_progress | completed`)
		return { content: text, status }
	})
}

/** Мягкая нормализация (план из протокола nessy): пустые записи отбрасываются, длинные усекаются. */
export function coercePlanEntries(entries: readonly PlanEntry[]): PlanEntry[] {
	return entries
		.map(e => ({ content: e.content.trim().slice(0, PLAN_ENTRY_MAX), status: e.status }))
		.filter(e => e.content !== '')
		.slice(0, PLAN_MAX_ENTRIES)
}

const MARKS: Readonly<Record<string, PlanStatus>> = { ' ': 'pending', x: 'completed', X: 'completed', '~': 'in_progress', '>': 'in_progress' }
const CHECKBOX_RE = /^(?:[-*+]\s+)?\[([ xX~>])\]\s*(.*)$/s
const BULLET_RE = /^[-*+]\s+/

/** Одна строка чек-листа: `- [x] шаг` → completed, `- [~]`/`- [>]` → in_progress, `- [ ]` и просто текст → pending. */
export function parsePlanLine(line: string): PlanEntry {
	const s = line.trim()
	const m = CHECKBOX_RE.exec(s)
	if (m) return { content: (m[2] ?? '').trim(), status: MARKS[m[1] ?? ' '] ?? 'pending' }
	return { content: s.replace(BULLET_RE, '').trim(), status: 'pending' }
}

/** Аргументы CLI → записи плана: каждый аргумент — запись (многострочный — по записи на непустую строку). */
export function parsePlanArgs(args: readonly string[]): PlanEntry[] {
	const lines = args.flatMap(a => a.split('\n')).filter(l => l.trim() !== '')
	return validatePlanEntries(lines.map(parsePlanLine))
}

/** Чек-лист для вывода: `[x] шаг`. */
export function formatPlanLine(e: PlanEntry): string {
	const mark = e.status === 'completed' ? 'x' : e.status === 'in_progress' ? '~' : ' '
	return `[${mark}] ${e.content}`
}

/** План выполнен целиком. */
export function isPlanDone(plan: AgentPlan | null): boolean {
	return plan !== null && plan.entries.every(e => e.status === 'completed')
}

/** План в начале нового хода: сбросить, если это новая задача от оператора после выполненного плана. */
export function planOnTurnStart(plan: AgentPlan | null, fromOperator: boolean, queued: number): AgentPlan | null {
	return fromOperator && queued === 0 && isPlanDone(plan) ? null : plan
}
