import { planProgress } from '@/entities/agent'
import { PermissionButtons } from '@/features/permission'
import type { SectionProps } from '../model/types'
import s from './AgentDetail.module.css'

/** Что ждёт вас: запрос разрешения (с кнопками) или ошибка хода. */
export function Alert({ agent, state }: SectionProps) {
	const perm = agent.pendingPermissions[0]
	if (state === 'wait' && perm)
		return (
			<div className={`${s.alert} ${s.alertWait}`} role="group" aria-label={`${agent.name}: запрос разрешения`}>
				<b>
					<span className={s.badge}>разрешение</span>
					Агент просит разрешение
				</b>
				<code>{perm.title}</code>
				<div className={s.alertActs}>
					<PermissionButtons key={perm.requestId} agentId={agent.id} requestId={perm.requestId} />
				</div>
				{agent.pendingPermissions.length > 1 && <span className={s.alertNote}>и ещё запросов: {agent.pendingPermissions.length - 1}</span>}
			</div>
		)
	if (state === 'error') {
		const step = planProgress(agent)?.step
		return (
			<div className={`${s.alert} ${s.alertError}`} role="group" aria-label={`${agent.name}: ошибка`}>
				<b>Ошибка</b>
				<code>{agent.error ?? agent.lastReply?.failed ?? 'ход завершился ошибкой'}</code>
				{step && <span className={s.alertNote}>Агент остановился на шаге «{step}»</span>}
			</div>
		)
	}
	return null
}
