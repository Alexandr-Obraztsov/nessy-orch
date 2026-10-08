/**
 * Левая панель — дерево как file explorer в Obsidian: поиск; «Агенты» по папкам пространств;
 * «Архив» (свёрнут); «Роли»; «Пространства». На узких экранах — выезжающая панель
 * с переходами «Лента» и «Граф» сверху.
 */
import { useMemo, useRef, useState } from 'react'
import { toggleTheme, useTheme } from '@/shared/lib/theme'
import { useNow } from '@/shared/lib/useNow'
import { activeTab, openDialog, openFeed, openGraph, openRole, toggleSidebar, useStore, useView } from '@/shared/model'
import { Icon, IconButton, StatusDot } from '@/shared/ui'
import { SPACE_STATUS } from '@/entities/agent'
import { foldersOf, matchAgent, matchRole, matchSpace, sortAgents } from '../lib/filter'
import { toggleFolder, useCollapse } from '../model/collapse'
import { useRemoveRole, useRemoveSpace } from '../model/useRemove'
import { AgentRow } from './AgentRow'
import { RemoveRoleDialog, RemoveSpaceDialog } from './ConfirmDialogs'
import { RoleRow } from './RoleRow'
import { SpaceRow } from './SpaceRow'
import { Row } from './Row'
import { Section } from './Section'
import s from './Sidebar.module.css'

export function Sidebar() {
	const agents = useStore(st => st.agents)
	const spaces = useStore(st => st.spaces)
	const roles = useStore(st => st.roles)
	const tab = useView(v => activeTab(v))
	const collapse = useCollapse()
	const [query, setQuery] = useState('')
	const search = useRef<HTMLInputElement>(null)
	const q = query.trim()
	const now = useNow(1000)
	const removeSpace = useRemoveSpace()
	const removeRole = useRemoveRole()
	const theme = useTheme()

	const roleById = useMemo(() => new Map(roles.map(r => [r.id, r])), [roles])
	const roleName = (id: string | null): string => (id ? (roleById.get(id)?.name ?? '') : '')

	const live = useMemo(() => agents.filter(a => !a.archived && matchAgent(a, q, roleName(a.role))), [agents, q, roleById])
	const archived = useMemo(() => sortAgents(agents.filter(a => a.archived && matchAgent(a, q, roleName(a.role)))), [agents, q, roleById])
	const folders = useMemo(() => foldersOf(live, spaces), [live, spaces])
	const roleList = useMemo(() => roles.filter(r => matchRole(r, q)).sort((a, b) => a.name.localeCompare(b.name, 'ru')), [roles, q])
	const spaceList = useMemo(() => spaces.filter(sp => matchSpace(sp, q)), [spaces, q])
	const users = useMemo(() => {
		const m = new Map<string, number>()
		for (const a of agents) if (a.role) m.set(a.role, (m.get(a.role) ?? 0) + 1)
		return m
	}, [agents])

	const activeAgent = tab.kind === 'agent' ? tab.id : null
	const activeRole = tab.kind === 'role' ? tab.id : undefined
	const searching = q.length > 0
	const nothing = searching && !live.length && !archived.length && !roleList.length && !spaceList.length

	return (
		<nav className={s.sidebar} aria-label="Навигация">
			<div className={s.top}>
				<div className={s.mobileHead}>
					<span className={s.brand}>nessy-orch</span>
					<IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} onClick={toggleTheme} />
					<IconButton icon="close" label="Закрыть панель" onClick={() => toggleSidebar(false)} />
				</div>
				<label className={s.search}>
					<Icon name="search" size={14} />
					<input
						ref={search}
						type="search"
						value={query}
						onChange={e => setQuery(e.target.value)}
						onKeyDown={e => {
							if (e.key === 'Escape' && query) {
								e.preventDefault()
								e.stopPropagation()
								setQuery('')
							}
						}}
						placeholder="Поиск"
						aria-label="Поиск по агентам, ролям и пространствам"
						spellCheck={false}
						data-sidebar-search
					/>
					{query && (
						<button type="button" className={s.clear} aria-label="Очистить поиск" onClick={() => setQuery('')}>
							<Icon name="close" size={12} />
						</button>
					)}
				</label>
			</div>

			<div className={s.scroll}>
				<div className={s.mobileNav}>
					<Row lead={<Icon name="feed" size={15} />} name="Лента" active={tab.kind === 'feed'} onClick={openFeed} />
					<Row lead={<Icon name="graph" size={15} />} name="Граф" active={tab.kind === 'graph'} onClick={openGraph} />
				</div>

				<Section
					id="agents"
					title="Агенты"
					count={agents.filter(a => !a.archived).length}
					forceOpen={searching}
					action={{ icon: 'plus', label: 'Новый агент', onClick: () => openDialog('spawn') }}
				>
					{folders.map(f => {
						const closed = collapse.folders[f.key] === true && !searching
						const st = f.space ? SPACE_STATUS[f.space.status] : null
						return (
							<div key={f.key} role="group" aria-label={`Пространство ${f.key}`}>
								<Row
									lead={
										<Icon name="chevronRight" size={12} strokeWidth={2.2} className={`${s.chev} ${closed ? '' : s.chevOpen}`} />
									}
									name={
										<span className={s.folderName}>
											{f.key}
											{st && f.space?.status !== 'ready' && <StatusDot color={st.color} pulse={st.pulse} size={6} title={st.label} />}
										</span>
									}
									meta={f.working ? <span className={s.timer}>{f.working} раб.</span> : f.agents.length}
									title={f.space?.path ?? f.key}
									expanded={!closed}
									onClick={() => toggleFolder(f.key)}
									actions={
										<IconButton
											icon="plus"
											label={`Новый агент в ${f.key}`}
											size="sm"
											onClick={() => openDialog('spawn', { space: f.key })}
										/>
									}
								/>
								{!closed &&
									f.agents.map(a => (
										<AgentRow key={a.id} agent={a} role={roleById.get(a.role ?? '')} depth={1} active={a.id === activeAgent} now={now} />
									))}
							</div>
						)
					})}
					{!folders.length && (
						<p className={s.empty}>
							{searching ? 'Нет совпадений' : 'Нет активных агентов.'}{' '}
							{!searching && (
								<button type="button" className={s.link} onClick={() => openDialog('spawn')}>
									Запустить
								</button>
							)}
						</p>
					)}
				</Section>

				<Section id="archive" title="Архив" count={agents.filter(a => a.archived).length} forceOpen={searching && archived.length > 0}>
					{archived.map(a => (
						<AgentRow key={a.id} agent={a} role={roleById.get(a.role ?? '')} depth={0} active={a.id === activeAgent} now={now} showSpace />
					))}
					{!archived.length && <p className={s.empty}>{searching ? 'Нет совпадений' : 'Пусто — сюда уходят агенты, выполнившие задачу'}</p>}
				</Section>

				<Section
					id="roles"
					title="Роли"
					count={roles.length}
					forceOpen={searching}
					action={{ icon: 'plus', label: 'Новая роль', onClick: () => openRole(null) }}
				>
					{roleList.map(r => (
						<RoleRow key={r.id} role={r} users={users.get(r.id) ?? 0} active={activeRole === r.id} onRemove={removeRole.ask} />
					))}
					{activeRole === null && (
						<Row lead={<Icon name="tag" size={13} />} name="Новая роль" active muted onClick={() => openRole(null)} />
					)}
					{!roleList.length && activeRole !== null && (
						<p className={s.empty}>
							{searching ? 'Нет совпадений' : 'Ролей пока нет.'}{' '}
							{!searching && (
								<button type="button" className={s.link} onClick={() => openRole(null)}>
									Создать
								</button>
							)}
						</p>
					)}
				</Section>

				<Section
					id="spaces"
					title="Пространства"
					count={spaces.length}
					forceOpen={searching}
					action={{ icon: 'plus', label: 'Добавить пространство', onClick: () => openDialog('space') }}
				>
					{spaceList.map(sp => (
						<SpaceRow key={sp.name} space={sp} onRemove={removeSpace.ask} />
					))}
					{!spaceList.length && <p className={s.empty}>{searching ? 'Нет совпадений' : 'Пространств пока нет'}</p>}
				</Section>
				{nothing && <p className={s.empty}>По запросу «{q}» ничего не найдено</p>}
			</div>
			<RemoveSpaceDialog r={removeSpace} />
			<RemoveRoleDialog r={removeRole} users={removeRole.target ? (users.get(removeRole.target.id) ?? 0) : 0} />
		</nav>
	)
}
