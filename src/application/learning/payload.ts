/** Строковое поле `payload` задания; нет или не строка — пустая строка. */
export function payloadStr(payload: Record<string, unknown> | null, key: string): string {
	const v = payload?.[key]
	return typeof v === 'string' ? v : ''
}
