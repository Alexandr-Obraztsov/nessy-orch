/** Сводка в левом верхнем углу: «5 агентов · 2 работают», ожидание разрешений, ошибки. */
import { AGENT_STATUS } from '@/entities/agent'
import { useStore } from '@/shared/model'
import { StatusDot } from '@/shared/ui'
import { plural } from '../lib/plural'
import o from './Overlays.module.css'

export function SummaryChips() {
	const agents = useStore(s => s.agents)
	if (!agents.length) return null
	const working = agents.filter(a => a.status === 'working' || a.status === 'starting').length
	const perms = agents.reduce((n, a) => n + a.pendingPermissions.length, 0)
	const errors = agents.filter(a => a.status === 'error').length
	const spaces = new Set(agents.map(a => a.space)).size
	return (
		<div className={o.summary} aria-live="polite">
			<span className={`${o.chip} ${o.glass}`}>
				<b>{agents.length}</b> {plural(agents.length, ['агент', 'агента', 'агентов'])}
				{working > 0 && (
					<>
						<span aria-hidden="true">·</span>
						<StatusDot color={AGENT_STATUS.working.color} pulse size={7} />
						<b>{working}</b> {plural(working, ['работает', 'работают', 'работают'])}
					</>
				)}
			</span>
			{spaces > 1 && (
				<span className={`${o.chip} ${o.glass}`}>
					<b>{spaces}</b> {plural(spaces, ['пространство', 'пространства', 'пространств'])}
				</span>
			)}
			{perms > 0 && (
				<span className={`${o.chip} ${o.glass} ${o.chipWarn}`}>
					<b>{perms}</b> {plural(perms, ['запрос', 'запроса', 'запросов'])} разрешения
				</span>
			)}
			{errors > 0 && (
				<span className={`${o.chip} ${o.glass} ${o.chipDanger}`}>
					<b>{errors}</b> с ошибкой
				</span>
			)}
		</div>
	)
}
