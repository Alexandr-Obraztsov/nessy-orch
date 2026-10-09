/**
 * Сайдбар как в Claude Desktop: задачи оркестраторов (активные сверху — живой индикатор, владелец,
 * число агентов, «ждёт вас»; ниже — завершённые), «Все агенты» и «Без задачи»; внизу — справочники
 * и тема. Клик открывает задачу, cmd/ctrl-клик или кнопка «рядом» — добавляет колонку справа.
 * На десктопе сворачивается, на узком экране — выезжает поверх.
 */
import { useMemo, useState, type MouseEvent } from 'react'
import type { AgentView, TaskView } from '@contract'
import { splitTasks, taskOf, taskStats } from '@/entities/task'
import { plural } from '@/shared/lib/plural'
import { cycleTheme, useThemePref } from '@/shared/lib/theme'
import {
	ALL_AGENTS,
	NO_TASK,
	getState,
	openColumn,
	openPage,
	openRole,
	reconnectNow,
	setDrawer,
	setSidebar,
	toggleColumnBeside,
	useOrchStatus,
	useStore,
	useView,
	type ColumnId,
} from '@/shared/model'
import { Icon, IconButton, Sparkle } from '@/shared/ui'
import s from './Sidebar.module.css'

const THEME_LABEL = { system: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' } as const
const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' } as const

export function Sidebar() {
	const tasks = useStore(st => st.tasks)
	const agents = useStore(st => st.agents)
	const conn = useStore(st => st.conn)
	const status = useOrchStatus()
	const page = useView(v => v.page.kind)
	const columns = useView(v => v.columns)
	const drawer = useView(v => v.drawer)
	const pref = useThemePref()
	const [doneOpen, setDoneOpen] = useState(false)

	const { active, done } = useMemo(() => splitTasks(tasks), [tasks])
	const byTask = useMemo(() => {
		const m = new Map<string | null, AgentView[]>()
		for (const a of agents) {
			const k = taskOf(a)
			const list = m.get(k)
			if (list) list.push(a)
			else m.set(k, [a])
		}
		return m
	}, [agents])
	const orphans = byTask.get(null) ?? []
	const isOpen = (id: ColumnId): boolean => page === 'main' && columns.includes(id)

	const pick = (id: ColumnId) => (e: MouseEvent): void => {
		if (e.metaKey || e.ctrlKey) toggleColumnBeside(id)
		else openColumn(id)
	}

	const item = (id: ColumnId, t: TaskView | null, label: string, list: AgentView[]) => {
		const st = taskStats(list)
		const done = t?.status === 'done'
		return (
			<li key={id} className={s.li}>
				<button
					type="button"
					className={s.item}
					aria-current={isOpen(id) || undefined}
					data-task={id}
					onClick={pick(id)}
					title={t ? `${t.title}\nCmd/Ctrl-клик — открыть рядом` : undefined}
				>
					<span className={s.ind} aria-hidden="true">
						{st.waiting > 0 ? <i className={s.dotWait} /> : st.working > 0 ? <Sparkle size={13} /> : done ? <Icon name="check" size={12} strokeWidth={2.2} /> : <i className={s.dotIdle} />}
					</span>
					<span className={s.text}>
						<span className={s.label}>{label}</span>
						<span className={s.sub}>
							{[t?.owner, list.length ? plural(list.length, 'агент', 'агента', 'агентов') : 'нет агентов'].filter(Boolean).join(' · ')}
						</span>
					</span>
					{st.waiting > 0 && <span className={s.wait}>ждёт вас</span>}
				</button>
				{t && (
					<button
						type="button"
						className={s.beside}
						aria-label={`Открыть рядом: ${t.title}`}
						title="Открыть рядом"
						aria-pressed={columns.length > 1 && isOpen(id)}
						onClick={() => toggleColumnBeside(id)}
					>
						<Icon name="columns" size={14} />
					</button>
				)}
			</li>
		)
	}

	return (
		<>
			<aside className={s.side} data-drawer={drawer || undefined} aria-label="Задачи">
				<div className={s.top} data-drag="">
					<button type="button" className={s.brand} onClick={() => openColumn(ALL_AGENTS)}>
						<span className={s.mark} aria-hidden="true">
							✻
						</span>
						nessy
					</button>
					<IconButton icon="panel" size="sm" label="Свернуть боковую панель" className={s.collapse} onClick={() => (window.matchMedia('(max-width: 899px)').matches ? setDrawer(false) : setSidebar(false))} />
				</div>

				{conn !== 'live' && (
					<button type="button" className={s.conn} onClick={reconnectNow} title="Переподключить сейчас" data-conn-state={conn}>
						<i className={s.connDot} aria-hidden="true" />
						{conn === 'offline' ? 'Переподключение…' : 'Подключение…'}
					</button>
				)}

				<nav className={s.scroll}>
					<ul className={s.list}>
						{item(ALL_AGENTS, null, 'Все агенты', agents)}
						{orphans.length > 0 && item(NO_TASK, null, 'Без задачи', orphans)}
					</ul>

					<div className={s.section}>Задачи</div>
					{active.length === 0 && <p className={s.none}>Активных задач нет</p>}
					<ul className={s.list}>{active.map(t => item(t.id, t, t.title, byTask.get(t.id) ?? []))}</ul>

					{done.length > 0 && (
						<>
							<button type="button" className={`${s.section} ${s.sectionBtn}`} aria-expanded={doneOpen} onClick={() => setDoneOpen(v => !v)}>
								<Icon name="chevronRight" size={12} className={s.chev} />
								Завершённые <span className={s.n}>{done.length}</span>
							</button>
							{doneOpen && <ul className={`${s.list} ${s.doneList}`}>{done.map(t => item(t.id, t, t.title, byTask.get(t.id) ?? []))}</ul>}
						</>
					)}
				</nav>

				<div className={s.foot}>
					<button type="button" className={s.link} aria-current={page === 'roles' || undefined} onClick={() => openRole(getState().roles[0]?.id ?? null)}>
						<Icon name="tag" size={15} />
						Роли
					</button>
					<button type="button" className={s.link} aria-current={page === 'spaces' || undefined} onClick={() => openPage({ kind: 'spaces' })}>
						<Icon name="folder" size={15} />
						Пространства
					</button>
					<div className={s.footRow}>
						<span className={s.ver}>
							{status ? `v${status.version}` : ''}
							{status?.autoApprove ? ' · авто-разрешения' : ''}
						</span>
						<IconButton icon={THEME_ICON[pref]} size="sm" label={THEME_LABEL[pref]} onClick={cycleTheme} />
					</div>
				</div>
			</aside>
			<div className={s.scrim} data-show={drawer || undefined} onClick={() => setDrawer(false)} aria-hidden="true" />
		</>
	)
}

/** Кнопка «показать боковую панель» (когда она свёрнута или на узком экране). */
export function SidebarToggle({ className }: { className?: string }) {
	return (
		<IconButton
			icon="panel"
			label="Показать боковую панель"
			className={className}
			onClick={() => (window.matchMedia('(max-width: 899px)').matches ? setDrawer(true) : setSidebar(true))}
		/>
	)
}
