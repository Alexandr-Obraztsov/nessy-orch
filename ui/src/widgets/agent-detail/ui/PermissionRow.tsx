import { memo } from 'react'
import type { PermissionEvent } from '@contract'
import { PermissionButtons } from '@/features/permission'
import { Icon } from '@/shared/ui'
import type { PendingPermissionsProps, PermissionRowProps } from '../model/types'
import t from './Timeline.module.css'

function resolution(ev: PermissionEvent): { text: string; tone: 'ok' | 'no' | 'wait' } {
	if (!ev.resolved) return { text: 'без ответа', tone: 'wait' }
	if (ev.approved) return { text: ev.auto ? 'разрешено автоматически' : 'разрешено', tone: 'ok' }
	return { text: 'отклонено', tone: 'no' }
}

/** Запрос разрешения: компактная строка; кнопки — пока ждёт, итог — когда решён. */
export const PermissionRow = memo(function PermissionRow({ ev, agent, enter }: PermissionRowProps) {
	const pending = !ev.resolved && agent.pendingPermissions.some(p => p.requestId === ev.requestId)
	const r = resolution(ev)
	return (
		<div className={[t.perm, pending ? t.permPending : t[r.tone], enter && t.enter].filter(Boolean).join(' ')}>
			<Icon name="shield" size={13} className={t.rowIcon} />
			<span className={t.permTitle} title={ev.title}>
				{ev.title}
			</span>
			{pending ? <PermissionButtons agentId={agent.id} requestId={ev.requestId} /> : <span className={t.permResult}>{r.text}</span>}
		</div>
	)
})

/** Ожидающие запросы, которых нет в загруженной истории, — над полем ввода. */
export function PendingPermissions({ agent, shown }: PendingPermissionsProps) {
	const rest = agent.pendingPermissions.filter(p => !shown.has(p.requestId))
	if (rest.length === 0) return null
	return (
		<div className={t.pendingBar} role="alert">
			{rest.map(p => (
				<div key={p.requestId} className={[t.perm, t.permPending].join(' ')}>
					<Icon name="shield" size={13} className={t.rowIcon} />
					<span className={t.permTitle} title={p.title}>
						{p.title}
					</span>
					<PermissionButtons agentId={agent.id} requestId={p.requestId} />
				</div>
			))}
		</div>
	)
}
