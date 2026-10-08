/** Безопасное усечение для превью. */
export function clip(s: unknown, n = 200): string {
	const t = typeof s === 'string' ? s : s == null ? '' : JSON.stringify(s)
	return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/** Markdown → простой текст для превью: без разметки, пробелы схлопнуты. */
export function plainText(md: string): string {
	return md
		.replace(/```[^\n]*\n?/g, ' ')
		.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_`~|]+/g, '')
		.replace(/\s+/g, ' ')
		.trim()
}
