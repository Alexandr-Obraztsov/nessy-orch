/**
 * Адрес вида для главного окна: задача и открытое окно агента («?task=…&agent=…»).
 * Чистая функция — без React и стора.
 */
export function mainQuery(taskId: string | null, agentId: string): string {
	const q = new URLSearchParams()
	q.set('task', taskId ?? '@none')
	q.set('agent', agentId)
	return `?${q.toString().replace(/%40/g, '@')}`
}
