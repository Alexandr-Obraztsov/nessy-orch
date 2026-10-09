/**
 * Корневой компонент: подключение к потоку; слева сайдбар задач (как в Claude Desktop), справа —
 * страница (задачи с карточками агентов или справочники Роли / Пространства); диалог пространства и всплывашки.
 * В поповере из строки меню (оболочка Electron, mode = popover) — отдельная компактная раскладка.
 */
import { useEffect } from 'react'
import { AddSpaceDialog } from '@/features/add-space'
import { MainPage } from '@/pages/main'
import { PopoverPage } from '@/pages/popover'
import { RolesPage } from '@/pages/roles'
import { SpacesPage } from '@/pages/spaces'
import { useDesktop } from '@/shared/lib/desktop'
import { NARROW, useMedia } from '@/shared/lib/useMedia'
import { connect, useStore, useView } from '@/shared/model'
import { Toaster } from '@/shared/ui'
import { Sidebar, SidebarToggle } from '@/widgets/sidebar'
import s from './App.module.css'
import { useHotkeys } from './useHotkeys'
import { useTabTitle } from './useTabTitle'

export function App() {
	const { mode } = useDesktop()
	return mode === 'popover' ? <PopoverApp /> : <MainApp desktop={mode === 'window'} />
}

function PopoverApp() {
	const conn = useStore(st => st.conn)
	useEffect(connect, [])
	return (
		<div className={s.popover} data-conn={conn}>
			<PopoverPage />
			<Toaster />
		</div>
	)
}

function MainApp({ desktop }: { desktop: boolean }) {
	const page = useView(v => v.page)
	const sidebar = useView(v => v.sidebar)
	const conn = useStore(st => st.conn)
	const narrow = useMedia(NARROW)

	useEffect(connect, [])
	useHotkeys()
	useTabTitle()

	let body
	switch (page.kind) {
		case 'main':
			body = <MainPage />
			break
		case 'roles':
			body = <RolesPage roleId={page.roleId} />
			break
		case 'spaces':
			body = <SpacesPage />
			break
	}

	const hidden = narrow || !sidebar
	return (
		<div className={s.app} data-conn={conn} data-sidebar={sidebar ? 'open' : 'closed'}>
			<Sidebar />
			<div className={s.content}>
				{/* в приложении — заголовок окна (перетаскивание); в браузере — только кнопка сайдбара */}
				{(hidden || desktop) && (
					<div className={s.strip} data-drag={desktop || undefined} data-titlebar={desktop || undefined}>
						{hidden && <SidebarToggle />}
						{hidden && narrow && <span className={s.brand}>nessy</span>}
					</div>
				)}
				{body}
			</div>
			<AddSpaceDialog />
			<Toaster />
		</div>
	)
}
