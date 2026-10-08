/**
 * Строка состояния внизу: соединение, счётчики агентов, авто-разрешения, версия.
 */
import { isBusy } from '@/entities/agent'
import { reconnectNow, useStore } from '@/shared/model'
import { Icon } from '@/shared/ui'
import { useOrchStatus } from '../model/useOrchStatus'
import s from './StatusBar.module.css'

const CONN = { live: 'в сети', connecting: 'подключение…', offline: 'нет связи' } as const

export function StatusBar() {
	const conn = useStore(st => st.conn)
	const agents = useStore(st => st.agents)
	const status = useOrchStatus()
	const working = agents.filter(isBusy).length
	const archived = agents.filter(a => a.archived).length
	const active = agents.length - archived
	const perms = agents.reduce((n, a) => n + a.pendingPermissions.length, 0)

	return (
		<footer className={s.bar}>
			<span className={`${s.item} ${s[conn]}`} role="status" aria-live="polite">
				<span className={s.dot} />
				{CONN[conn]}
				{conn === 'offline' && (
					<button type="button" className={s.link} onClick={reconnectNow}>
						переподключить
					</button>
				)}
			</span>
			<span className={s.item} data-testid="counters">
				<span className={working ? s.working : undefined}>{working} работают</span>
				<span className={s.sepDot}>·</span>
				{active} активных
				<span className={s.sepDot}>·</span>
				{archived} в архиве
			</span>
			{perms > 0 && (
				<span className={`${s.item} ${s.warn}`}>
					<Icon name="shield" size={12} />
					ждут разрешения: {perms}
				</span>
			)}
			<span className={s.grow} />
			{status?.autoApprove && (
				<span className={s.item} title="Запросы разрешений одобряются автоматически">
					<Icon name="check" size={12} />
					авто-разрешения
				</span>
			)}
			{status && <span className={`${s.item} ${s.faint}`}>v{status.version}</span>}
		</footer>
	)
}
