/**
 * Современный вывод cli-v2: цвета, компактные статусы, дерево. Только форматирование строк.
 * Базовые цвета/`status` переиспользуются из `../cli/format` (общие примитивы без HTTP).
 */
import type { AgentView } from '../../../shared/types'
import { bold, dim, status as statusColor } from '../cli/format'

/** Цветной маркер статуса агента/пространства: ● работает, ○ свободен, ✖ ошибка, … */
export function statusDot(s: string): string {
	switch (s) {
		case 'working':
		case 'starting':
		case 'active':
			return statusColor('●')
		case 'idle':
		case 'ready':
		case 'done':
			return statusColor('○')
		case 'error':
		case 'failed':
		case 'stopped':
			return statusColor('✖')
		default:
			return '○'
	}
}

/** «рантайм · модель» агента; если поля не отданы сервером — прочерк. */
export function runtimeModelCell(a: AgentView): string {
	const runtime = (a as { runtime?: string }).runtime
	const model = (a as { model?: string }).model
	const parts: string[] = []
	if (runtime) parts.push(runtime)
	if (model) parts.push(model)
	return parts.length ? dim(parts.join(' · ')) : dim('—')
}

/** Заполнение окна контекста (%): от 60% красим красным. */
export function contextCell(a: AgentView): string {
	const pct = a.stats.contextPct
	if (pct === null || pct === undefined) return dim('—')
	return pct >= 60 ? statusColor(String(pct)) + '%' : `${pct}%`
}

/** Компактная строка «id — статус — занят/план» для дерева. */
export function agentCell(a: AgentView): string {
	const busy = a.queued ? dim(` +${a.queued}`) : ''
	const archived = a.archived ? dim(' · архив') : ''
	return `${bold(a.id)} ${statusDot(a.status)}${busy}${archived}`
}
