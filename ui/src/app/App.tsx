/**
 * Корневой компонент: подключение к потоку, верхняя строка и страница
 * (главная таблица агентов или справочники Роли / Пространства), диалог пространства и всплывашки.
 */
import { useEffect } from 'react'
import { AddSpaceDialog } from '@/features/add-space'
import { MainPage } from '@/pages/main'
import { RolesPage } from '@/pages/roles'
import { SpacesPage } from '@/pages/spaces'
import { connect, useStore, useView } from '@/shared/model'
import { Toaster } from '@/shared/ui'
import { TopBar } from '@/widgets/topbar'
import s from './App.module.css'
import { useHotkeys } from './useHotkeys'
import { useTabTitle } from './useTabTitle'

export function App() {
	const page = useView(v => v.page)
	const conn = useStore(st => st.conn)

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

	return (
		<div className={s.app} data-conn={conn}>
			<TopBar />
			{body}
			<AddSpaceDialog />
			<Toaster />
		</div>
	)
}
