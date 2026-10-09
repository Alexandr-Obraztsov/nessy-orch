/**
 * Строка инструмента как в Claude Code: «⏺ Bash  npm test -- gateway». Точка — статус:
 * серая мерцающая — в работе, зелёная — готово, красная — ошибка, янтарная — ждёт разрешения.
 */
import type { ReactNode } from 'react'
import type { ToolView } from '../lib/state.types'
import s from './ToolLine.module.css'

export type ToolTone = 'run' | 'ok' | 'err' | 'wait' | 'idle'

export interface ToolLineProps {
	tool: ToolView
	tone: ToolTone
	/** справа: краткий итог («42 строки», «exit 1») */
	aside?: ReactNode
	className?: string
}

export function ToolLine({ tool, tone, aside, className }: ToolLineProps) {
	return (
		<span className={[s.line, className].filter(Boolean).join(' ')} data-tone={tone}>
			<i className={s.dot} aria-hidden="true" />
			<b className={s.name}>{tool.name}</b>
			{tool.arg && (
				<span className={s.arg} title={tool.arg}>
					{tool.arg}
				</span>
			)}
			{aside !== undefined && <span className={s.aside}>{aside}</span>}
		</span>
	)
}
