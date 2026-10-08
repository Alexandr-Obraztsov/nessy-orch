/**
 * Левая колонка «Внимание»: очередь того, что ждёт вас, по срочности —
 * разрешения (агент заблокирован) → ошибки (ход упал) → результаты (ответ вам).
 */
import { useMemo } from 'react'
import type { AttentionItem, AttentionList } from '@/entities/attention'
import { useTasks } from '@/entities/task'
import { useOrchStatus, useView } from '@/shared/model'
import { AttentionCard } from './AttentionCard'
import s from './Attention.module.css'

export function AttentionPanel({ list }: { list: AttentionList }) {
	const tasks = useTasks()
	const selected = useView(v => v.selectedAgentId)
	const status = useOrchStatus()
	const titles = useMemo(() => {
		const m = new Map<string, string>()
		for (const t of tasks) for (const r of t.agents) m.set(r.agent.id, t.title)
		return m
	}, [tasks])

	const section = (label: string, items: AttentionItem[]) =>
		items.length > 0 && (
			<>
				<div className={s.subH}>{label}</div>
				{items.map(it => (
					<AttentionCard key={it.key} item={it} selected={selected === it.agent.id} taskTitle={titles.get(it.agent.id) ?? null} />
				))}
			</>
		)

	const unread = list.results.filter(r => r.unread).length
	return (
		<section className={s.panel} aria-label="Внимание">
			<div className={s.secH}>
				Внимание
				<span className={`${s.n} ${list.permissions.length ? s.nWarn : ''}`}>{list.total}</span>
			</div>
			{list.total === 0 ? (
				<div className={s.empty}>
					<b>Всё разобрано</b>
					Ничего не ждёт вашего решения
					{status?.autoApprove && <span className={s.emptyNote}>Включены авто-разрешения: запросы одобряются сами</span>}
				</div>
			) : (
				<>
					{section('Разрешения · агент заблокирован', list.permissions)}
					{section('Ошибки · ход упал', list.errors)}
					{section(unread ? `Результаты · новых ${unread}` : 'Результаты', list.results)}
				</>
			)}
		</section>
	)
}
