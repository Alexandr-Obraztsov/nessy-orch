/** Безопасное усечение для превью. */
export function clip(s: unknown, n = 200): string {
	const t = typeof s === 'string' ? s : s == null ? '' : JSON.stringify(s)
	return t.length > n ? t.slice(0, n - 1) + '…' : t
}
