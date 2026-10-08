/**
 * Журнал — нижний ящик. Свёрнутый: одна строка с последними событиями. Развёрнутый: хронология
 * всех сообщений и служебных событий (новые сверху) с фильтрами по типу, агенту, поручению и поиском.
 * На узких экранах — отдельная вкладка на весь экран.
 */
import { useMemo, useState } from 'react'
import { useTasks } from '@/entities/task'
import { clockSec } from '@/shared/lib/time'
import { nodeLabel, openAgent, toggleJournal, useStore, useView } from '@/shared/model'
import { Icon } from '@/shared/ui'
import { matchesEntry, oneLine, toEntry } from '../lib/entries'
import type { JournalFilter, JournalProps, JournalType } from '../model/types'
import s from './Journal.module.css'

const LIMIT = 400
const TYPES: Array<[JournalType | 'all', string]> = [
	['all', 'Все'],
	['msg', 'Сообщения'],
	['reply', 'Ответы'],
	['error', 'Ошибки'],
	['system', 'Служебные'],
]
const GLYPH: Record<JournalType, string> = { msg: '✉', reply: '↩', error: '✖', system: '·' }

export function Journal({ mode }: JournalProps) {
	const messages = useStore(st => st.messages)
	const agents = useStore(st => st.agents)
	const tasks = useTasks()
	const drawerOpen = useView(v => v.journalOpen)
	const open = mode === 'full' || drawerOpen
	const [type, setType] = useState<JournalFilter['type']>('all')
	const [agent, setAgent] = useState('')
	const [task, setTask] = useState('')
	const [query, setQuery] = useState('')

	const label = (id: string): string => nodeLabel(agents, id)
	const entries = useMemo(() => messages.map(toEntry), [messages])
	const taskIds = useMemo(() => {
		const t = tasks.find(x => x.id === task)
		return t ? new Set(t.agents.map(r => r.agent.id)) : null
	}, [tasks, task])
	const shown = useMemo(() => {
		if (!open) return []
		const f: JournalFilter = { type, agent, task: taskIds, query }
		const out = []
		for (let i = entries.length - 1; i >= 0 && out.length < LIMIT; i--) {
			const e = entries[i]
			if (e && matchesEntry(e, f, id => nodeLabel(agents, id))) out.push(e)
		}
		return out
	}, [open, entries, type, agent, taskIds, query, agents])

	const latest = entries.slice(-3).reverse()
	const who = (from: string, to: string): string => (to === 'system' || to === from ? label(from) : `${label(from)} → ${label(to)}`)

	return (
		<section className={[s.drawer, open && s.open, mode === 'full' && s.full].filter(Boolean).join(' ')} aria-label="Журнал">
			{mode === 'drawer' && (
				<button type="button" className={s.head} aria-expanded={open} onClick={() => toggleJournal()}>
					<span className={s.lbl}>Журнал</span>
					<Icon name="chevronDown" size={13} className={s.ar} />
					<span className={s.last}>
						{latest.length === 0
							? 'событий пока нет'
							: latest.map((e, i) => (
									<span key={e.id}>
										{i > 0 && <span className={s.dot}> · </span>}
										<span className={s.lastTs}>{clockSec(e.ts).slice(0, 5)}</span> <b>{who(e.from, e.to)}</b> {oneLine(e.text, 90)}
									</span>
								))}
					</span>
				</button>
			)}
			{open && (
				<div className={s.body}>
					<div className={s.filters}>
						<div className={s.types} role="group" aria-label="Тип событий">
							{TYPES.map(([v, l]) => (
								<button key={v} type="button" className={s.chip} aria-pressed={type === v} onClick={() => setType(v)}>
									{l}
								</button>
							))}
						</div>
						<select className={s.sel} value={agent} onChange={e => setAgent(e.target.value)} aria-label="Агент">
							<option value="">все агенты</option>
							<option value="you">Вы</option>
							{agents.map(a => (
								<option key={a.id} value={a.id}>
									{a.name}
								</option>
							))}
						</select>
						<select className={s.sel} value={task} onChange={e => setTask(e.target.value)} aria-label="Поручение">
							<option value="">все поручения</option>
							{tasks.map(t => (
								<option key={t.id} value={t.id}>
									{oneLine(t.title, 48)}
								</option>
							))}
						</select>
						<input
							className={s.q}
							value={query}
							onChange={e => setQuery(e.target.value)}
							placeholder="Поиск в журнале"
							aria-label="Поиск в журнале"
							spellCheck={false}
						/>
					</div>
					<div className={s.list} role="log" aria-label="События журнала">
						{shown.length === 0 ? (
							<div className={s.empty}>Нет событий</div>
						) : (
							shown.map(e => (
								<div
									key={e.id}
									className={`${s.lg} ${s[e.type] ?? ''}`}
									role={e.agentId ? 'button' : undefined}
									tabIndex={e.agentId ? 0 : undefined}
									onClick={e.agentId ? () => e.agentId && openAgent(e.agentId) : undefined}
									title={e.text}
								>
									<span className={s.ts}>{clockSec(e.ts)}</span>
									<span className={s.k} aria-hidden="true">
										{GLYPH[e.type]}
									</span>
									<span className={s.who}>{who(e.from, e.to)}</span>
									<span className={s.tx}>{oneLine(e.text, 400)}</span>
								</div>
							))
						)}
					</div>
				</div>
			)}
		</section>
	)
}
