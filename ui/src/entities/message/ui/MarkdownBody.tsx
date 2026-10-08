import { renderMarkdown } from '@/shared/lib/markdown'
import type { MarkdownBodyProps } from '../model/types'
import s from './MarkdownBody.module.css'

/** Текст в markdown (ответы агентов, сообщения) — плотная типографика как в заметке Obsidian. */
export function MarkdownBody({ text, streaming, className }: MarkdownBodyProps) {
	return (
		<div
			className={[s.md, streaming && s.streaming, className].filter(Boolean).join(' ')}
			dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
		/>
	)
}
