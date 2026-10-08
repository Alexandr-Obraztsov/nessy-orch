/**
 * Markdown → одна строка простого текста для превью свёрнутого ответа:
 * без разметки, ссылок, заголовков, маркеров списков и лишних пробелов.
 */
export function plainText(md: string, max = 280): string {
	const text = md
		// блоки кода: оставляем содержимое без ограды
		.replace(/```[^\n]*\n?([\s\S]*?)```/g, ' $1 ')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/<[^>]+>/g, ' ')
		.replace(/^\s{0,3}#{1,6}\s+/gm, '')
		.replace(/^\s*>\s?/gm, '')
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
		.replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, ' ')
		.replace(/\|/g, ' ')
		.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ' ')
		.replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
		.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\s+/g, ' ')
		.trim()
	return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Первая непустая строка текста (для «Размышления · …»). */
export function firstLine(text: string): string {
	for (const line of text.split('\n')) {
		const t = line.trim()
		if (t) return t
	}
	return ''
}
