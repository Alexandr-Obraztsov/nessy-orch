/**
 * Каркас страницы-справочника (Роли, Пространства): «← назад», заголовок со счётчиком, действия справа.
 */
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import s from './RefPage.module.css'

export interface RefPageProps {
	title: string
	count?: number
	backLabel: string
	onBack: () => void
	actions?: ReactNode
	children: ReactNode
}

export function RefPage({ title, count, backLabel, onBack, actions, children }: RefPageProps) {
	return (
		<div className={s.page}>
			<div className={s.bar}>
				<button type="button" className={s.back} onClick={onBack}>
					<Icon name="chevronLeft" size={14} />
					{backLabel}
				</button>
				<h1 className={s.h1}>{title}</h1>
				{count !== undefined && <span className={s.count}>{count}</span>}
				<span className={s.grow} />
				{actions}
			</div>
			<div className={s.body}>{children}</div>
		</div>
	)
}
