/**
 * Центральная колонка: список поручений с группировкой, фильтром по сводке и поиском.
 * Карточки сворачиваются (по умолчанию готовые свёрнуты), готовые уходят в группы «Завершённые …».
 */
import { useMemo } from 'react'
import { TASK_STATUS_LABEL, filterTasks, groupTasks, isOpen, useTasks, type TaskGroup } from '@/entities/task'
import { useNow } from '@/shared/lib/useNow'
import { openDialog, setFilter, setGrouping, setSearch, toggleCollapsed, useStore, useView, type Grouping } from '@/shared/model'
import { Button, Icon } from '@/shared/ui'
import { AgentRow } from './AgentRow'
import { TaskCard } from './TaskCard'
import s from './Tasks.module.css'

const GROUPINGS: Array<[Grouping, string]> = [
	['tasks', 'поручения'],
	['spaces', 'пространства'],
	['roles', 'роли'],
	['flat', 'плоский список'],
]

export function TasksPanel() {
	const tasks = useTasks()
	const roles = useStore(st => st.roles)
	const spaces = useStore(st => st.spaces)
	const conn = useStore(st => st.conn)
	const filter = useView(v => v.filter)
	const search = useView(v => v.search)
	const grouping = useView(v => v.grouping)
	const collapsed = useView(v => v.collapsed)
	const selectedId = useView(v => v.selectedAgentId)
	// минутная точность достаточна для «сегодня / ранее»
	const now = useNow(60_000)

	const list = useMemo(() => filterTasks(tasks, filter, search, roles), [tasks, filter, search, roles])
	const groups = useMemo(() => groupTasks(list, grouping, { spaces, roles, now }), [list, grouping, spaces, roles, now])
	const filtered = filter !== 'all' || search.trim() !== ''

	const renderGroup = (g: TaskGroup) => {
		if (g.kind === 'agents')
			return (
				<section key={g.key} className={s.group}>
					{g.label && (
						<div className={s.gH}>
							{g.label} · {g.rows.length}
						</div>
					)}
					<div className={s.flat}>
						{g.rows.map(r => (
							<AgentRow key={r.agent.id} row={r} selected={selectedId === r.agent.id} flat />
						))}
					</div>
				</section>
			)
		if (g.tasks.length === 0) return null
		// при фильтре «готово» группы завершённых раскрыты
		const open = !g.collapsible || filter === 'done' || isOpen(g.key, g.defaultOpen, collapsed)
		return (
			<section key={g.key} className={s.group}>
				{g.label &&
					(g.collapsible ? (
						<button type="button" className={`${s.gH} ${s.gBtn}`} aria-expanded={open} onClick={() => toggleCollapsed(g.key)}>
							<Icon name="chevronRight" size={12} className={s.chev} />
							{g.label} ({g.tasks.length})
						</button>
					) : (
						<div className={s.gH}>{g.label}</div>
					))}
				{open &&
					g.tasks.map(t => <TaskCard key={t.id} task={t} open={isOpen(t.id, t.status !== 'done', collapsed)} selectedId={selectedId} />)}
			</section>
		)
	}

	return (
		<section className={s.panel} aria-label="Поручения">
			<div className={s.head}>
				<div className={s.secH}>
					Поручения<span className={s.n}>{list.length}</span>
				</div>
				{filtered && (
					<span className={s.flt}>
						фильтр:{filter !== 'all' ? ` ${TASK_STATUS_LABEL[filter]}` : ''}
						{search.trim() ? ` «${search.trim()}»` : ''}
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								if (filter !== 'all') setFilter(filter)
								setSearch('')
							}}
						>
							сбросить ✕
						</Button>
					</span>
				)}
				<label className={s.grp}>
					<span className={s.grpLbl}>группировка:</span>
					<select value={grouping} onChange={e => setGrouping(e.target.value as Grouping)} aria-label="Группировка">
						{GROUPINGS.map(([v, l]) => (
							<option key={v} value={v}>
								{l}
							</option>
						))}
					</select>
				</label>
			</div>
			<div className={s.scroll} data-tasks-scroll>
				{tasks.length === 0 ? (
					<div className={s.empty}>
						{conn === 'live' ? (
							<>
								<b>Поручений пока нет</b>
								<p>Дайте задачу агенту — она появится здесь вместе со всеми агентами, которых он породит.</p>
								<Button variant="primary" icon="plus" onClick={() => openDialog('spawn')}>
									Поручение
								</Button>
							</>
						) : (
							<p>{conn === 'connecting' ? 'Подключение к оркестратору…' : 'Нет связи с оркестратором'}</p>
						)}
					</div>
				) : list.length === 0 ? (
					<div className={s.empty}>
						<p>Ничего не найдено по текущему фильтру</p>
					</div>
				) : (
					groups.map(renderGroup)
				)}
			</div>
		</section>
	)
}
