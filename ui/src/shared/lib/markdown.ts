/**
 * Markdown → безопасный HTML (ответы агентов). marked + DOMPurify, ссылки открываются в новой вкладке.
 */
import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

DOMPurify.addHook('afterSanitizeAttributes', node => {
	if (node.tagName === 'A') {
		node.setAttribute('target', '_blank')
		node.setAttribute('rel', 'noopener noreferrer')
	}
})

const cache = new Map<string, string>()

export function renderMarkdown(src: string): string {
	const hit = cache.get(src)
	if (hit !== undefined) return hit
	const html = DOMPurify.sanitize(marked.parse(src, { async: false }))
	if (cache.size > 500) cache.clear()
	cache.set(src, html)
	return html
}
