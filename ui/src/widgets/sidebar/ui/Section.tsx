import type { ReactNode } from 'react'
import { useMedia } from '@/shared/lib/useMedia'
import { Icon, IconButton, type IconName } from '@/shared/ui'
import { toggleSection, useCollapse } from '../model/collapse'
import type { SectionId } from '../model/types'
import s from './Sidebar.module.css'

export interface SectionProps {
	id: SectionId
	title: string
	count?: number
	/** при поиске секция раскрыта принудительно */
	forceOpen?: boolean
	action?: { icon: IconName; label: string; onClick: () => void }
	children: ReactNode
}

/** Секция дерева: заголовок со стрелкой, счётчиком и кнопкой действия. */
export function Section({ id, title, count, forceOpen, action, children }: SectionProps) {
	const collapsed = useCollapse().sections[id] === true && !forceOpen
	const touch = useMedia('(hover: none)')
	return (
		<section className={s.section} aria-label={title}>
			<div className={s.sectionHead}>
				<button type="button" className={s.sectionToggle} aria-expanded={!collapsed} onClick={() => toggleSection(id)}>
					<Icon name="chevronRight" size={12} strokeWidth={2.2} className={`${s.chev} ${collapsed ? '' : s.chevOpen}`} />
					<span>{title}</span>
					{count !== undefined && <span className={s.count}>{count}</span>}
				</button>
				{action && (
					<IconButton icon={action.icon} label={action.label} size="sm" className={touch ? undefined : s.sectionAction} onClick={action.onClick} />
				)}
			</div>
			{!collapsed && <div className={s.sectionBody}>{children}</div>}
		</section>
	)
}
