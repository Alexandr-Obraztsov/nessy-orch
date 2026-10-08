/**
 * Группа агентов одного пространства: заголовок (сворачивается), живые агенты,
 * подгруппа «остановленные» (по умолчанию свёрнута).
 */
import { useState } from 'react'
import { SPACE_STATUS } from '@/entities/agent'
import { openSpawn } from '@/features/spawn-agent'
import { Icon, IconButton, StatusDot } from '@/shared/ui'
import type { RosterGroup as Group } from '../model/types'
import { AgentRow } from './AgentRow'
import { cssVars } from '@/shared/lib/style'
import s from './Roster.module.css'

export interface RosterGroupProps {
	group: Group
	collapsed: boolean
	onToggle: () => void
	selected: string | null
	searching: boolean
}

export function RosterGroup({ group: g, collapsed, onToggle, selected, searching }: RosterGroupProps) {
	const [deadOpen, setDeadOpen] = useState(false)
	const sst = g.space ? SPACE_STATUS[g.space.status] : null
	const showDead = deadOpen || (searching && g.alive.length === 0) || g.dead.some(a => a.id === selected)
	const open = !collapsed || searching
	const title = g.space
		? `${g.space.path}\n${sst?.label ?? ''}${g.space.mode === 'external' ? ' · внешний serve' : ''}`
		: 'Пространство удалено'

	return (
		<section className={s.group} style={cssVars({ '--hue': g.hue })}>
			<div className={s.groupHead}>
				<button type="button" className={s.groupBtn} onClick={onToggle} aria-expanded={open} title={title}>
					<Icon name="chevronDown" size={14} className={`${s.chev} ${open ? '' : s.chevClosed}`} />
					<span className={s.hue} />
					<span className={s.groupName}>{g.key}</span>
					{sst && g.space?.status !== 'ready' && <StatusDot color={sst.color} pulse={sst.pulse} size={6} title={sst.label} />}
					<span className={s.groupCount} title={`Работают: ${g.working}, всего: ${g.total}`}>
						{g.working > 0 && <span className={s.groupWorking}>{g.working} · </span>}
						{g.total}
					</span>
				</button>
				{g.space && (
					<IconButton icon="plus" size="sm" label={`Новый агент в «${g.key}»`} className={s.groupAdd} onClick={() => openSpawn(g.key)} />
				)}
			</div>
			<div className={`${s.groupBody} ${open ? s.groupOpen : ''}`}>
				<div className={s.groupInner}>
					{g.alive.map(a => (
						<AgentRow key={a.id} agent={a} hue={g.hue} selected={a.id === selected} />
					))}
					{!g.alive.length && !g.dead.length && <p className={s.groupEmpty}>Агентов нет</p>}
					{g.dead.length > 0 && (
						<>
							<button type="button" className={s.deadToggle} onClick={() => setDeadOpen(o => !o)} aria-expanded={showDead}>
								<Icon name="chevronRight" size={13} className={`${s.chevSm} ${showDead ? s.chevSmOpen : ''}`} />
								остановленные
								<span className={s.groupCount}>{g.dead.length}</span>
							</button>
							{showDead && g.dead.map(a => <AgentRow key={a.id} agent={a} hue={g.hue} selected={a.id === selected} />)}
						</>
					)}
				</div>
			</div>
		</section>
	)
}
