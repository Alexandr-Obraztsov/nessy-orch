/**
 * Лента-рейка слева (как ribbon в Obsidian): быстрые действия иконками; внизу — тема и соединение.
 */
import { toggleTheme, useTheme } from '@/shared/lib/theme'
import { activeTab, openDialog, openFeed, openGraph, openRole, reconnectNow, useStore, useView } from '@/shared/model'
import { Icon, type IconName } from '@/shared/ui'
import s from './Ribbon.module.css'

interface ItemProps {
	icon: IconName
	label: string
	active?: boolean
	onClick: () => void
}

function Item({ icon, label, active, onClick }: ItemProps) {
	return (
		<button type="button" className={`${s.item} ${active ? s.active : ''}`} aria-label={label} title={label} aria-pressed={active} onClick={onClick}>
			<Icon name={icon} size={18} strokeWidth={1.7} />
		</button>
	)
}

const CONN = {
	live: { label: 'Соединение: в сети', cls: s.live },
	connecting: { label: 'Соединение: подключение…', cls: s.connecting },
	offline: { label: 'Нет связи с оркестратором — переподключить', cls: s.offline },
} as const

export function Ribbon() {
	const kind = useView(v => activeTab(v).kind)
	const theme = useTheme()
	const conn = useStore(st => st.conn)
	const c = CONN[conn]
	return (
		<div className={s.ribbon} role="toolbar" aria-orientation="vertical" aria-label="Быстрые действия">
			<Item icon="feed" label="Лента (F)" active={kind === 'feed'} onClick={openFeed} />
			<Item icon="graph" label="Граф (G)" active={kind === 'graph'} onClick={openGraph} />
			<div className={s.sep} />
			<Item icon="plus" label="Новый агент (N)" onClick={() => openDialog('spawn')} />
			<Item icon="tag" label="Новая роль (R)" onClick={() => openRole(null)} />
			<Item icon="folder" label="Добавить пространство" onClick={() => openDialog('space')} />
			<div className={s.grow} />
			<Item icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} onClick={toggleTheme} />
			<button
				type="button"
				className={`${s.item} ${s.conn}`}
				aria-label={c.label}
				title={c.label}
				onClick={() => conn === 'offline' && reconnectNow()}
			>
				<span className={`${s.connDot} ${c.cls}`} />
			</button>
		</div>
	)
}
