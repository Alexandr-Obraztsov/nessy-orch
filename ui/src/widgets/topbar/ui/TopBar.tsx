/**
 * Верхняя строка: бренд, сводка-фильтры, авто-разрешения, поиск («/»), «+ Поручение», меню ⚙, тема.
 * Строка состояния свёрнута сюда же: «нет связи» показывается бейджем, версия — в меню.
 */
import { useRef, useState } from 'react'
import { toggleTheme, useTheme } from '@/shared/lib/theme'
import { NARROW, useMedia } from '@/shared/lib/useMedia'
import { closeAgent, getState, openDialog, openPage, openRole, reconnectNow, setSearch, useOrchStatus, useStore, useView } from '@/shared/model'
import { Button, Icon, IconButton, MenuItem, MenuLabel, MenuSeparator, Popover } from '@/shared/ui'
import { SummaryChips } from './SummaryChips'
import s from './TopBar.module.css'

const CONN = { connecting: 'подключение…', offline: 'нет связи' } as const

export function TopBar() {
	const narrow = useMedia(NARROW)
	const page = useView(v => v.page.kind)
	const search = useView(v => v.search)
	const conn = useStore(st => st.conn)
	const status = useOrchStatus()
	const theme = useTheme()
	const [menu, setMenu] = useState(false)
	const menuBtn = useRef<HTMLButtonElement>(null)

	const home = (): void => openPage({ kind: 'main' })
	const go = (fn: () => void) => (): void => {
		setMenu(false)
		fn()
	}

	return (
		<header className={s.top}>
			<button type="button" className={s.brand} onClick={home} title="К поручениям">
				nessy-orch
			</button>
			{!narrow && page === 'main' && <SummaryChips />}
			{status?.autoApprove && (
				<span className={s.auto} title="Запросы разрешений одобряются автоматически — секция «Разрешения» будет пустой">
					авто-разрешения
				</span>
			)}
			{conn !== 'live' && (
				<button type="button" className={`${s.conn} ${s[conn]}`} onClick={reconnectNow} title="Переподключить">
					<Icon name="wifiOff" size={13} />
					{CONN[conn]}
				</button>
			)}
			<span className={s.sp} />
			{page === 'main' && (
				<label className={s.search}>
					<Icon name="search" size={13} />
					<input
						data-search
						value={search}
						onChange={e => setSearch(e.target.value)}
						onKeyDown={e => {
							if (e.key === 'Escape') {
								e.preventDefault()
								if (search) setSearch('')
								else e.currentTarget.blur()
							}
						}}
						placeholder="Поиск по поручениям и результатам"
						aria-label="Поиск"
						spellCheck={false}
					/>
					{!search && <kbd className={s.kbd}>/</kbd>}
				</label>
			)}
			<Button variant="primary" className={s.new} onClick={() => openDialog('spawn')} title="Новое поручение (n)">
				<Icon name="plus" size={14} strokeWidth={2.2} />
				<span className={s.long}>Поручение</span>
			</Button>
			<IconButton
				ref={menuBtn}
				icon="settings"
				label="Справочники"
				className={s.iconBtn}
				aria-haspopup="menu"
				aria-expanded={menu}
				onClick={() => setMenu(v => !v)}
			/>
			<Popover open={menu} anchor={menuBtn.current} onClose={() => setMenu(false)} align="end" label="Справочники" role="menu">
				<MenuItem icon="feed" onClick={go(home)}>
					Поручения
				</MenuItem>
				<MenuItem
					icon="tag"
					onClick={go(() => {
						closeAgent()
						openRole(getState().roles[0]?.id ?? null)
					})}
				>
					Роли
				</MenuItem>
				<MenuItem
					icon="folder"
					onClick={go(() => {
						closeAgent()
						openPage({ kind: 'spaces' })
					})}
				>
					Пространства
				</MenuItem>
				<MenuSeparator />
				<MenuLabel>
					{status ? `v${status.version} · ${status.autoApprove ? 'авто-разрешения включены' : 'разрешения вручную'}` : 'nessy-orch'}
				</MenuLabel>
			</Popover>
			<IconButton
				icon={theme === 'dark' ? 'moon' : 'sun'}
				label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
				className={s.iconBtn}
				onClick={toggleTheme}
			/>
		</header>
	)
}
