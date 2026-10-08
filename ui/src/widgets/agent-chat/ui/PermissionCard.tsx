import { memo } from 'react'
import type { AgentView, PermissionEvent } from '@contract'
import { PermissionButtons } from '@/features/permission'
import { Icon } from '@/shared/ui'
import s from './PermissionCard.module.css'

function resolution(ev: PermissionEvent): { text: string; tone: 'ok' | 'no' | 'wait' } {
	if (!ev.resolved) return { text: 'без ответа', tone: 'wait' }
	if (ev.approved) return { text: ev.auto ? 'разрешено автоматически' : 'разрешено', tone: 'ok' }
	return { text: 'отклонено', tone: 'no' }
}

/** Запрос разрешения: кнопки, пока ждёт; итог — когда решён. */
export const PermissionCard = memo(function PermissionCard({
	ev,
	agent,
	enter,
}: {
	ev: PermissionEvent
	agent: AgentView
	enter: boolean
}) {
	const pending = !ev.resolved && agent.pendingPermissions.some(p => p.requestId === ev.requestId)
	const r = resolution(ev)
	return (
		<div className={[s.card, pending ? s.pending : s[r.tone], enter && s.enter].filter(Boolean).join(' ')}>
			<div className={s.head}>
				<Icon name="shield" size={16} className={s.icon} />
				<div className={s.text}>
					<span className={s.kicker}>{pending ? 'Запрос разрешения' : 'Разрешение'}</span>
					<span className={s.title}>{ev.title}</span>
				</div>
				{!pending && (
					<span className={s.result}>
						<Icon name={r.tone === 'ok' ? 'check' : r.tone === 'no' ? 'x' : 'clock'} size={12} strokeWidth={2.4} />
						{r.text}
					</span>
				)}
			</div>
			{pending && (
				<div className={s.actions}>
					<PermissionButtons agentId={agent.id} requestId={ev.requestId} />
				</div>
			)}
		</div>
	)
})
