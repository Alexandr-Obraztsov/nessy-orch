/**
 * Главная таблица: липкая шапка колонок, группы «Работают» и «Выполнено» с липкими
 * сворачиваемыми заголовками и счётчиками. Строки переезжают между группами FLIP-анимацией.
 */
import { useCallback, useRef } from 'react'
import { useTaskTitles } from '@/entities/task'
import { useNow } from '@/shared/lib/useNow'
import { openAgent, toggleCollapsed, useStore, useView } from '@/shared/model'
import { Icon } from '@/shared/ui'
import { buildGroups } from '../lib/rows'
import type { GroupHeaderProps } from '../model/types'
import { useFlip } from '../model/useFlip'
import { useTransitions } from '../model/useTransitions'
import s from './AgentTable.module.css'
import { AgentRow } from './AgentRow'

const GROUP = {
	work: { label: 'Работают', note: 'сначала требующие внимания' },
	done: { label: 'Выполнено', note: 'новые сверху' },
} as const

function GroupHeader({ group, collapsed, onToggle }: GroupHeaderProps) {
	const g = GROUP[group.key]
	return (
		<button type="button" className={s.groupHead} data-group={group.key} aria-expanded={!collapsed} onClick={onToggle}>
			<Icon name="chevronDown" size={12} className={s.chev} />
			<span className={s.groupDot} aria-hidden="true" />
			<span className={s.groupLabel}>{g.label}</span>
			<span key={group.rows.length} className={s.groupCount}>
				{group.rows.length}
			</span>
			<span className={s.groupNote}>{g.note}</span>
		</button>
	)
}

export function AgentTable() {
	const agents = useStore(st => st.agents)
	const roles = useStore(st => st.roles)
	const conn = useStore(st => st.conn)
	const titles = useTaskTitles()
	const filter = useView(v => v.filter)
	const hideDone = useView(v => v.hideDone)
	const collapsed = useView(v => v.collapsed)
	const selected = useView(v => v.selectedAgentId)
	const now = useNow(1000)
	const tr = useTransitions(agents)
	const scroll = useRef<HTMLDivElement>(null)

	const groups = buildGroups(agents, { roles, titles, filter, tr })
	// «Скрыть выполненные» не действует, когда выбран сам фильтр «Выполнено»
	const visible = groups.filter(g => g.rows.length > 0 && !(g.key === 'done' && hideDone && filter !== 'done'))
	const orderKey = visible.map(g => `${g.key}:${g.rows.map(r => r.agent.id).join(',')}`).join('|')
	const layoutKey = `${collapsed.join(',')}|${hideDone}|${filter}`
	useFlip(scroll, orderKey, layoutKey)

	const open = useCallback((id: string) => openAgent(id), [])
	const empty = visible.length === 0

	return (
		<div className={s.scroll} ref={scroll}>
			<div className={s.table} role="table" aria-label="Агенты">
				<div className={s.colHead} role="row">
					<span role="columnheader" className={s.cSt}>
						<span className="sr-only">Статус</span>
					</span>
					<span role="columnheader">Агент</span>
					<span role="columnheader" className={s.cTask}>
						Задача
					</span>
					<span role="columnheader">Прогресс</span>
					<span role="columnheader" className={s.cNow}>
						Сейчас
					</span>
					<span role="columnheader" className={s.cTime}>
						Время
					</span>
					<span role="columnheader">
						<span className="sr-only">Действия</span>
					</span>
				</div>
				{groups.map(g => {
					const shown = visible.includes(g)
					const isCollapsed = collapsed.includes(g.key)
					return (
						<section
							key={g.key}
							className={[s.group, !shown && s.groupOff, isCollapsed && s.collapsed].filter(Boolean).join(' ')}
							data-group={g.key}
							role="rowgroup"
							aria-label={GROUP[g.key].label}
							aria-hidden={!shown || undefined}
							data-hidden={!shown || isCollapsed || undefined}
						>
							<GroupHeader group={g} collapsed={isCollapsed} onToggle={() => toggleCollapsed(g.key)} />
							<div className={s.groupBody}>
								<div className={s.groupInner}>
									{g.rows.map(r => {
										const live = r.state === 'working' || r.state === 'starting' || r.state === 'wait'
										return <AgentRow key={r.agent.id} row={r} selected={r.agent.id === selected} now={live ? now : 0} onOpen={open} />
									})}
								</div>
							</div>
						</section>
					)
				})}
				{empty && (
					<div className={s.empty}>
						{conn !== 'live' && agents.length === 0 ? (
							'Подключение к оркестратору…'
						) : agents.length === 0 ? (
							<>
								<b>Агентов пока нет</b>
								<span>Их запускает оркестратор (Claude) командой nessy-orch spawn — здесь видно, как они работают.</span>
							</>
						) : (
							'Нет агентов под этот фильтр'
						)}
					</div>
				)}
			</div>
		</div>
	)
}
