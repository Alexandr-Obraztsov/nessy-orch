import type { MouseEvent } from 'react'
import { copyText } from '@/shared/lib/clipboard'
import { renderMarkdown } from '@/shared/lib/markdown'
import type { MarkdownBodyProps } from '../model/types'
import s from './MarkdownBody.module.css'

/** Кнопка «Копировать» в шапке блока кода (её рисует renderMarkdown) — делегированием. */
function onCopy(e: MouseEvent<HTMLDivElement>): void {
	if (!(e.target instanceof Element)) return
	const btn = e.target.closest('[data-copy]')
	if (!btn) return
	const code = btn.closest('.md-code')?.querySelector('pre code')
	if (code?.textContent != null) void copyText(code.textContent, 'Код скопирован')
}

/** Текст в markdown (сообщения агентов): спокойная типографика Claude, код с подсветкой и копированием. */
export function MarkdownBody({ text, streaming, className }: MarkdownBodyProps) {
	return (
		<div
			className={[s.md, streaming && s.streaming, className].filter(Boolean).join(' ')}
			onClick={onCopy}
			dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
		/>
	)
}
