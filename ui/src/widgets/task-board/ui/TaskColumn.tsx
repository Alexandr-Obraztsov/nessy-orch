/**
 * Колонка задачи: заголовок (serif), владелец, статус, итог (когда задача завершена) и карточки
 * агентов адаптивной сеткой. Порядок: ждут разрешения → работают → ошибка → ждут поручения;
 * выполненные — свёрнутая группа «Выполнено · n». В параллельном просмотре — крестик закрытия.
 */
import { useMemo, useRef, useState } from 'react'
import type { AgentView, TaskView } from '@contract'
import { agentState, briefOf, sortCards, useFirstMessages } from '@/entities/agent'
import { MarkdownBody } from '@/entities/message'
import { agentsOf, taskOf, taskStats } from '@/entities/task'
import { plural } from '@/shared/lib/plural'
import { ago } from '@/shared/lib/time'
import { ALL_AGENTS, NO_TASK, closeColumn, openAgent, useStore } from '@/shared/model'
import { Icon, IconButton, Sparkle } from '@/shared/ui'
import { AgentCard } from '@/widgets/agent-card'
import type { TaskColumnProps } from '../model/types'
import { useFlip } from '@/shared/lib/useFlip'
import s from './TaskColumn.module.css'

export function TaskColumn({ column, parallel }: TaskColumnProps) {
	const agents = useStore(st => st.agents)
	const tasks = useStore(st => st.tasks)
	const conn = useStore(st => st.conn)
	const first = useFirstMessages()
	const task = tasks.find(t => t.id === column)
	const special = column === ALL_AGENTS || column === NO_TASK

	const list = useMemo(() => sortCards(agentsOf(agents, column)), [agents, column])
	const work = list.filter(a => agentState(a) !== 'done')
	const done = list.filter(a => agentState(a) === 'done')
	const stats = taskStats(list)
	const titles = useMemo(() => new Map(tasks.map(t => [t.id, t.title])), [tasks])

	const [doneOpen, setDoneOpen] = useState<boolean | null>(null)
	const showDone = doneOpen ?? work.length === 0
	const grid = useRef<HTMLDivElement>(null)
	useFlip(grid, `${work.map(a => a.id).join(',')}|${showDone ? done.map(a => a.id).join(',') : done.length}`)

	const title = column === ALL_AGENTS ? 'Все агенты' : column === NO_TASK ? 'Без задачи' : (task?.title ?? column)
	const missing = !special && !task

	const card = (a: AgentView, i: number) => (
		<AgentCard key={a.id} agent={a} brief={briefOf(a, first)} taskTitle={column === ALL_AGENTS ? titleOf(a, titles) : undefined} index={i} onOpen={openAgent} />
	)

	return (
		<section className={s.col} data-column={column} data-parallel={parallel || undefined} aria-label={title}>
			<header className={s.head}>
				<div className={s.titleRow}>
					<h1 className={s.title}>{title}</h1>
					{parallel && <IconButton icon="close" size="sm" label="Закрыть колонку" onClick={() => closeColumn(column)} className={s.close} />}
				</div>
				<Meta task={task} stats={stats} missing={missing && conn === 'live'} />
			</header>

			{task?.status === 'done' && task.summary && (
				<div className={s.summary}>
					<div className={s.summaryLabel}>Итог</div>
					<MarkdownBody text={task.summary} />
				</div>
			)}

			<div ref={grid} className={s.cards}>
				{list.length === 0 && !missing && <p className={s.empty}>{conn === 'live' ? 'Агентов пока нет' : 'Подключение…'}</p>}
				{work.length > 0 && <div className={s.grid}>{work.map(card)}</div>}
				{done.length > 0 && (
					<div className={s.group} data-open={showDone || undefined}>
						<button type="button" className={s.groupHead} aria-expanded={showDone} onClick={() => setDoneOpen(!showDone)}>
							<Icon name="chevronRight" size={13} className={s.chev} />
							Выполнено{' '}
							<span key={done.length} className={s.n}>
								· {done.length}
							</span>
						</button>
						<div className={s.groupBody}>
							<div className={s.groupIn}>{showDone && <div className={s.grid}>{done.map(card)}</div>}</div>
						</div>
					</div>
				)}
			</div>
		</section>
	)
}

function titleOf(a: AgentView, titles: Map<string, string>): string | null {
	const id = taskOf(a)
	return id ? (titles.get(id) ?? id) : null
}

function Meta({ task, stats, missing }: { task: TaskView | undefined; stats: ReturnType<typeof taskStats>; missing: boolean }) {
	if (missing) return <div className={s.meta}>Задача не найдена — возможно, её удалили</div>
	const parts: string[] = []
	if (task?.owner) parts.push(task.owner)
	parts.push(stats.total ? plural(stats.total, 'агент', 'агента', 'агентов') : 'нет агентов')
	if (task) parts.push(`обновлена ${ago(task.updatedAt)}`.replace('обновлена сейчас', 'обновлена только что'))
	return (
		<div className={s.meta}>
			{task?.status === 'done' ? (
				<span className={s.badgeDone}>
					<Icon name="check" size={12} strokeWidth={2.2} />
					Завершена
				</span>
			) : stats.working > 0 ? (
				<span className={s.badgeLive}>
					<Sparkle size={12} />
					{stats.working} в работе
				</span>
			) : null}
			{stats.waiting > 0 && <span className={s.badgeWait}>ждёт вас · {stats.waiting}</span>}
			{stats.error > 0 && <span className={s.badgeErr}>ошибок · {stats.error}</span>}
			<span>{parts.join(' · ')}</span>
		</div>
	)
}
