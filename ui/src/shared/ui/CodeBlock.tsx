/**
 * Моноблок кода/вывода с подсветкой (highlight.js): необязательная подпись, «Копировать»,
 * длинный текст обрезан по строкам с «Показать всё».
 */
import { useMemo, useState } from 'react'
import { copyText } from '@/shared/lib/clipboard'
import { highlight } from '@/shared/lib/highlight'
import { plural } from '@/shared/lib/plural'
import s from './CodeBlock.module.css'
import { Icon } from './Icon'

export interface CodeBlockProps {
	code: string
	/** язык highlight.js, 'auto' или null — без подсветки */
	lang: string | null
	/** подпись слева в шапке (IN / OUT, путь файла) */
	label?: string
	/** сколько строк показывать до «Показать всё» */
	maxLines?: number
	tone?: 'plain' | 'error'
	className?: string
}

export function CodeBlock({ code, lang, label, maxLines = 24, tone = 'plain', className }: CodeBlockProps) {
	const [all, setAll] = useState(false)
	const lines = useMemo(() => code.replace(/\n+$/, '').split('\n'), [code])
	const cut = !all && lines.length > maxLines + 4
	const shown = cut ? lines.slice(0, maxLines).join('\n') : lines.join('\n')
	const html = useMemo(() => highlight(shown, lang), [shown, lang])
	return (
		<div className={[s.block, className].filter(Boolean).join(' ')} data-tone={tone}>
			<div className={s.head}>
				<span className={s.label}>{label}</span>
				<button type="button" className={s.copy} onClick={() => void copyText(code)} aria-label="Копировать">
					<Icon name="copy" size={12} />
				</button>
			</div>
			<pre className={s.pre}>
				<code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
			</pre>
			{cut && (
				<button type="button" className={s.more} onClick={() => setAll(true)}>
					Показать всё · {plural(lines.length, 'строка', 'строки', 'строк')}
				</button>
			)}
		</div>
	)
}
