import type { MouseEvent, ReactNode } from 'react'
import { cssVars } from '@/shared/lib/style'
import s from './Sidebar.module.css'

export interface RowProps {
	/** уровень вложенности (0 — верхний) */
	depth?: number
	active?: boolean
	muted?: boolean
	lead: ReactNode
	name: ReactNode
	/** мелко справа (таймер, роль, счётчик) — прячется при наведении, если есть действия */
	meta?: ReactNode
	actions?: ReactNode
	title?: string
	onClick: () => void
	onContextMenu?: (e: MouseEvent) => void
	/** подпись для доступности (иначе — текст строки) */
	label?: string
	expanded?: boolean
}

/** Строка дерева 28px (на сенсорных — 40px): значок, имя, мета справа, действия при наведении. */
export function Row({ depth = 0, active, muted, lead, name, meta, actions, title, onClick, onContextMenu, label, expanded }: RowProps) {
	return (
		<div
			className={[s.row, active && s.rowActive, muted && s.rowMuted, actions && s.hasActions].filter(Boolean).join(' ')}
			style={cssVars({ '--depth': depth })}
			onContextMenu={onContextMenu}
		>
			<button
				type="button"
				className={s.rowMain}
				onClick={onClick}
				title={title}
				aria-label={label}
				aria-current={active ? 'page' : undefined}
				aria-expanded={expanded}
			>
				<span className={s.lead}>{lead}</span>
				<span className={s.name}>{name}</span>
				{meta !== undefined && meta !== null && meta !== false && <span className={s.meta}>{meta}</span>}
			</button>
			{actions && <span className={s.actions}>{actions}</span>}
		</div>
	)
}
