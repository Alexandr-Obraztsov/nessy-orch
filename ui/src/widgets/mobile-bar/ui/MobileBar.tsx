/**
 * Верхняя панель узких экранов: ☰ (левая панель), заголовок текущей вкладки, «+ агент».
 */
import type { ReactNode } from 'react'
import { openDialog, toggleSidebar, useStore, useView } from '@/shared/model'
import { IconButton } from '@/shared/ui'
import s from './MobileBar.module.css'

export interface MobileBarProps {
	title: string
	/** значок перед заголовком (статус агента, цвет роли) */
	lead?: ReactNode
	/** закрыть текущую вкладку (если можно) */
	onCloseTab?: () => void
}

export function MobileBar({ title, lead, onCloseTab }: MobileBarProps) {
	const open = useView(v => v.sidebarOpen)
	const conn = useStore(st => st.conn)
	return (
		<header className={s.bar}>
			<IconButton icon="menu" label="Открыть панель" aria-expanded={open} onClick={() => toggleSidebar()} />
			<div className={s.title}>
				{lead && <span className={s.lead}>{lead}</span>}
				<span className={s.text}>{title}</span>
				{conn === 'offline' && <span className={s.offline}>нет связи</span>}
			</div>
			{onCloseTab && <IconButton icon="close" label="Закрыть вкладку" onClick={onCloseTab} />}
			<IconButton icon="plus" label="Новый агент" onClick={() => openDialog('spawn')} />
		</header>
	)
}
