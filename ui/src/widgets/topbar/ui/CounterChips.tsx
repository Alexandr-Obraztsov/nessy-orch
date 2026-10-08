import { openAgent } from '@/shared/model'
import { Icon } from '@/shared/ui'
import type { Counters } from '../model/types'
import s from './TopBar.module.css'

/** Счётчики: агенты, работают, ждут разрешения (последнее — кликабельно). */
export function CounterChips({ c, vertical }: { c: Counters; vertical?: boolean }) {
	return (
		<div className={vertical ? s.countersCol : s.counters}>
			<span className={`${s.counter} ${s.cAgents}`} title={`Всего агентов: ${c.total}${c.dead ? `, остановлено: ${c.dead}` : ''}`}>
				<Icon name="users" size={14} />
				<b>{c.active}</b>
				<span className={s.cLabel}>агентов</span>
			</span>
			<span className={`${s.counter} ${s.cWorking} ${c.working ? s.on : ''}`} title="Сейчас выполняют ход">
				<span className={s.cDot} />
				<b>{c.working}</b>
				<span className={s.cLabel}>работают</span>
			</span>
			{c.permissions > 0 && (
				<button
					type="button"
					className={`${s.counter} ${s.cPerm}`}
					title="Открыть агента, который ждёт разрешения"
					onClick={() => c.firstPermissionAgent && openAgent(c.firstPermissionAgent)}
				>
					<Icon name="shield" size={14} />
					<b>{c.permissions}</b>
					<span className={s.cLabel}>ждут разрешения</span>
				</button>
			)}
		</div>
	)
}
