/**
 * Верхняя строка: бренд, состояние связи, авто-разрешения, «Скрыть выполненные», меню
 * справочников (Роли, Пространства) и тема. Создавать агентов и писать им панель не умеет —
 * это делает оркестратор (Claude) через CLI.
 */
import { useRef, useState } from 'react'
import { toggleTheme, useTheme } from '@/shared/lib/theme'
import { closeAgent, getState, openPage, openRole, reconnectNow, setHideDone, useOrchStatus, useStore, useView } from '@/shared/model'
import { Icon, IconButton, MenuItem, MenuLabel, MenuSeparator, Popover } from '@/shared/ui'
import s from './TopBar.module.css'

const CONN = { connecting: 'подключение…', offline: 'нет связи' } as const

export function TopBar() {
	const page = useView(v => v.page.kind)
	const hideDone = useView(v => v.hideDone)
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
			<button type="button" className={s.brand} onClick={home} title="К агентам">
				<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
					<path d="M3 5h14M3 10h14M3 15h8" />
				</svg>
				<span>nessy-orch</span>
			</button>
			{status?.autoApprove && (
				<span className={s.auto} title="Запросы разрешений одобряются автоматически — кнопок «Разрешить» не будет">
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
				<button type="button" className={s.switch} role="switch" aria-checked={hideDone} onClick={() => setHideDone(!hideDone)} title="Скрыть группу «Выполнено»">
					<span className={s.track} aria-hidden="true" />
					<span>
						Скрыть<span className={s.long}> выполненные</span>
					</span>
				</button>
			)}
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
					Агенты
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
			<IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} className={s.iconBtn} onClick={toggleTheme} />
		</header>
	)
}
