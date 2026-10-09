/**
 * Markdown → безопасный HTML (сообщения агентов). marked + DOMPurify, ссылки открываются в новой вкладке.
 * Блоки кода подсвечиваются (highlight.js) и получают шапку: язык и кнопку «Копировать»
 * (клик обрабатывает MarkdownBody делегированием по [data-copy]).
 */
import DOMPurify from 'dompurify'
import { Marked, type Tokens } from 'marked'
import { escapeHtml, highlight, knownLang, langLabel } from './highlight'

DOMPurify.addHook('afterSanitizeAttributes', node => {
	if (node.tagName === 'A') {
		node.setAttribute('target', '_blank')
		node.setAttribute('rel', 'noopener noreferrer')
	}
})

const COPY_ICON =
	'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 9h10v10H9zM5 15V5h10"/></svg>'

function codeBlock({ text, lang }: Tokens.Code): string {
	const name = (lang ?? '').split(/\s+/)[0] ?? ''
	const known = knownLang(name)
	const label = known ? langLabel(known) : name || 'текст'
	const body = known ? highlight(text, known) : escapeHtml(text)
	return (
		`<div class="md-code" data-lang="${escapeHtml(known ?? name)}">` +
		`<div class="md-code-head"><span>${escapeHtml(label)}</span>` +
		`<button type="button" class="md-code-copy" data-copy="" aria-label="Копировать код">${COPY_ICON}<span>Копировать</span></button></div>` +
		`<pre><code class="hljs">${body}</code></pre></div>`
	)
}

const md = new Marked({ gfm: true, breaks: true, renderer: { code: codeBlock } })

const cache = new Map<string, string>()

export function renderMarkdown(src: string): string {
	const hit = cache.get(src)
	if (hit !== undefined) return hit
	const html = DOMPurify.sanitize(md.parse(src, { async: false }))
	if (cache.size > 500) cache.clear()
	cache.set(src, html)
	return html
}
