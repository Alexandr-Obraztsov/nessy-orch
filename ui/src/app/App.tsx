/**
 * Корневой компонент: подключение к потоку, верхняя строка и страница
 * (рабочий экран «Три колонки» или справочники Роли / Пространства), диалоги и всплывашки.
 * «Внимание» считается здесь: от него зависят заголовок вкладки и всплывашки на любой странице.
 */
import { useEffect } from 'react'
import { useAttention, useAttentionTitle, useAttentionToasts, useMarkSeen } from '@/entities/attention'
import { AddSpaceDialog } from '@/features/add-space'
import { AgentConfirmHost } from '@/features/agent-actions'
import { SpawnAgentDialog } from '@/features/spawn-agent'
import { MainPage } from '@/pages/main'
import { RolesPage } from '@/pages/roles'
import { SpacesPage } from '@/pages/spaces'
import { NARROW, useMedia } from '@/shared/lib/useMedia'
import { connect, useStore, useView } from '@/shared/model'
import { Toaster } from '@/shared/ui'
import { SummaryChips, TopBar } from '@/widgets/topbar'
import s from './App.module.css'
import { useHotkeys } from './useHotkeys'

export function App() {
	const narrow = useMedia(NARROW)
	const page = useView(v => v.page)
	const selected = useView(v => v.selectedAgentId)
	const conn = useStore(st => st.conn)
	const attention = useAttention()

	useEffect(connect, [])
	useHotkeys()
	useAttentionTitle(attention.total)
	useAttentionToasts(attention)
	useMarkSeen(selected)

	let body
	switch (page.kind) {
		case 'main':
			body = <MainPage attention={attention} />
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
			{narrow && page.kind === 'main' && <SummaryChips />}
			{body}
			<SpawnAgentDialog />
			<AddSpaceDialog />
			<AgentConfirmHost />
			<Toaster />
		</div>
	)
}
