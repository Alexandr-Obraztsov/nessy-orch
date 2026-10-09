/**
 * Поповер из строки меню (оболочка Electron, окно 400×560 без рамки): компактная раскладка без сайдбара.
 * Шапка — ✻ nessy, сводка и «Открыть окно»; ниже чипы задач (активные, «Все»); список компактных
 * карточек: сначала ждущие разрешения, потом работающие; внизу свёрнутое «Выполнено · n».
 * Клик по карточке открывает агента в главном окне и прячет поповер.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentView } from '@contract'
import { agentState, briefOf, sortCards, useFirstMessages } from '@/entities/agent'
import { agentsOf, splitTasks, taskOf, taskStats } from '@/entities/task'
import { useDesktop } from '@/shared/lib/desktop'
import { plural } from '@/shared/lib/plural'
import { readStorage, writeStorage } from '@/shared/lib/storage'
import { useFlip } from '@/shared/lib/useFlip'
import { ALL_AGENTS, reconnectNow, useStore } from '@/shared/model'
import { Icon, IconButton, Sparkle } from '@/shared/ui'
import { mainQuery } from '../lib/query'
import type { TaskChip } from '../model/types'
import { MiniCard } from './MiniCard'
import s from './PopoverPage.module.css'

const KEY = 'nessy-orch:popover-task'

export function PopoverPage() {
	const agents = useStore(st => st.agents)
	const tasks = useStore(st => st.tasks)
	const conn = useStore(st => st.conn)
	const first = useFirstMessages()
	const shell = useDesktop()
	const [picked, setPicked] = useState<string>(() => readStorage(KEY) ?? ALL_AGENTS)
	const [doneOpen, setDoneOpen] = useState(false)

	const chips = useMemo<TaskChip[]>(() => {
		const { active } = splitTasks(tasks)
		const all = taskStats(agents)
		return [
			{ id: ALL_AGENTS, label: 'Все', waiting: all.waiting, working: all.working },
			...active.map(t => {
				const st = taskStats(agentsOf(agents, t.id))
				return { id: t.id, label: t.title, waiting: st.waiting, working: st.working }
			}),
		]
	}, [agents, tasks])

	// выбранная задача завершилась или удалена — показываем всех
	const column = chips.some(c => c.id === picked) || conn !== 'live' ? picked : ALL_AGENTS
	const list = useMemo(() => sortCards(agentsOf(agents, column)), [agents, column])
	const live = list.filter(a => agentState(a) !== 'done')
	const done = list.filter(a => agentState(a) === 'done')
	const stats = taskStats(list)

	const pick = (id: string): void => {
		setPicked(id)
		writeStorage(KEY, id)
	}
	const open = (a: AgentView): void => {
		shell.openMain(mainQuery(taskOf(a), a.id))
		shell.hidePopover()
	}

	const listRef = useRef<HTMLDivElement>(null)
	useFlip(listRef, `${column}|${live.map(a => a.id).join(',')}|${doneOpen ? done.map(a => a.id).join(',') : done.length}`)

	// активный чип — в видимой части ленты
	const chipsRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		chipsRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
	}, [column])

	return (
		<div className={s.page} data-popover="">
			<header className={s.head}>
				<div className={s.top}>
					<span className={s.brand}>
						<span className={s.mark} aria-hidden="true">
							✻
						</span>
						nessy
					</span>
					{conn === 'live' ? (
						<span className={s.summary}>{summaryOf(stats)}</span>
					) : (
						<button type="button" className={s.conn} onClick={reconnectNow} title="Переподключить сейчас">
							<i className={s.connDot} aria-hidden="true" />
							Переподключение…
						</button>
					)}
					<IconButton icon="maximize" size="sm" label="Открыть окно" className={s.openMain} onClick={() => shell.openMain(column === ALL_AGENTS ? '' : `?task=${column}`)} />
				</div>
				<div ref={chipsRef} className={s.chips} role="toolbar" aria-label="Задачи">
					{chips.map(c => (
						<button key={c.id} type="button" className={s.chip} aria-pressed={c.id === column} onClick={() => pick(c.id)} title={c.label}>
							{c.waiting > 0 ? <i className={s.chipWait} aria-hidden="true" /> : c.working > 0 ? <Sparkle size={11} motion="spin" /> : null}
							<span className={s.chipLabel}>{c.label}</span>
						</button>
					))}
				</div>
			</header>

			<div ref={listRef} className={s.scroll}>
				{live.length === 0 ? (
					<Empty connecting={conn !== 'live'} />
				) : (
					<div className={s.list}>
						{live.map((a, i) => (
							<MiniCard key={a.id} agent={a} brief={briefOf(a, first)} index={i} onOpen={open} />
						))}
					</div>
				)}
				{done.length > 0 && (
					<div className={s.done} data-open={doneOpen || undefined}>
						<button type="button" className={s.doneHead} aria-expanded={doneOpen} onClick={() => setDoneOpen(v => !v)}>
							<Icon name="chevronRight" size={13} className={s.chev} />
							Выполнено <span className={s.n}>· {done.length}</span>
						</button>
						{doneOpen && (
							<div className={s.list}>
								{done.map((a, i) => (
									<MiniCard key={a.id} agent={a} brief={briefOf(a, first)} index={i} onOpen={open} />
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	)
}

function summaryOf(st: ReturnType<typeof taskStats>): string {
	const parts: string[] = []
	if (st.waiting) parts.push(`${st.waiting} ждут вас`)
	if (st.working) parts.push(`${st.working} в работе`)
	if (st.error) parts.push(plural(st.error, 'ошибка', 'ошибки', 'ошибок'))
	return parts.join(' · ')
}

function Empty({ connecting }: { connecting: boolean }) {
	return (
		<div className={s.empty}>
			<span className={s.emptyMark} aria-hidden="true">
				✻
			</span>
			<p className={s.emptyTitle}>{connecting ? 'Подключаемся…' : 'Агенты отдыхают'}</p>
			<p className={s.emptySub}>{connecting ? 'Оркестратор вот-вот ответит' : 'Когда Claude поручит работу, агенты появятся здесь'}</p>
		</div>
	)
}
