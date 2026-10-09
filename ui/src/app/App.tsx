/**
 * Корневой компонент: подключение к потоку; слева сайдбар задач (как в Claude Desktop), справа —
 * страница (задачи с карточками агентов или справочники Роли / Пространства); диалог пространства и всплывашки.
 */
import { useEffect } from 'react'
import { AddSpaceDialog } from '@/features/add-space'
import { MainPage } from '@/pages/main'
import { RolesPage } from '@/pages/roles'
import { SpacesPage } from '@/pages/spaces'
import { NARROW, useMedia } from '@/shared/lib/useMedia'
import { connect, useStore, useView } from '@/shared/model'
import { Toaster } from '@/shared/ui'
import { Sidebar, SidebarToggle } from '@/widgets/sidebar'
import s from './App.module.css'
import { useHotkeys } from './useHotkeys'
import { useTabTitle } from './useTabTitle'

export function App() {
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
				{hidden && (
					<div className={s.strip}>
						<SidebarToggle />
						{narrow && <span className={s.brand}>nessy</span>}
					</div>
				)}
				{body}
			</div>
			<AddSpaceDialog />
			<Toaster />
		</div>
	)
}
