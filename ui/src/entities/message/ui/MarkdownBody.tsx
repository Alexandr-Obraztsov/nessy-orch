import { cssVars } from '@/shared/lib/style'
import { renderMarkdown } from '@/shared/lib/markdown'
import { Icon } from '@/shared/ui'
import { useCollapse } from '../lib/useCollapse'
import type { MarkdownBodyProps } from '../model/types'
import s from './MarkdownBody.module.css'

/** Текст сообщения/ответа агента в markdown, со сворачиванием длинных. */
export function MarkdownBody({ text, collapseAt = 0, onAccent, streaming, className }: MarkdownBodyProps) {
	const c = useCollapse(collapseAt)
	const clamped = c.overflow && !c.expanded
	const style = collapseAt > 0 ? cssVars({ '--clamp': `${collapseAt}px` }) : undefined
	return (
		<div className={[s.wrap, className].filter(Boolean).join(' ')}>
			<div
				ref={c.ref}
				className={[s.md, onAccent && s.onAccent, streaming && s.streaming, clamped && s.clamped].filter(Boolean).join(' ')}
				style={style}
				dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
			/>
			{c.overflow && (
				<button type="button" className={s.more} onClick={c.toggle} aria-expanded={c.expanded}>
					<Icon name="chevronDown" size={14} className={c.expanded ? s.flip : undefined} />
					{c.expanded ? 'Свернуть' : 'Показать полностью'}
				</button>
			)}
		</div>
	)
}
