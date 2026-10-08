import { memo } from 'react'
import type { PermissionEvent } from '@contract'
import { PermissionButtons } from '@/features/permission'
import { Icon } from '@/shared/ui'
import { formatMs } from '../lib/toolIcon'
import type { PermissionRowProps } from '../model/types'
import t from './Timeline.module.css'

function resolution(ev: PermissionEvent): { text: string; tone: 'ok' | 'no' | 'wait' } {
	if (!ev.resolved) return { text: 'без ответа', tone: 'wait' }
	if (ev.approved) return { text: ev.auto ? 'разрешено автоматически' : 'разрешено', tone: 'ok' }
	return { text: 'отклонено', tone: 'no' }
}

/** Запрос разрешения: компактная строка; кнопки — пока ждёт, итог — когда решён. */
export const PermissionRow = memo(function PermissionRow({ ev, agent, enter, durationMs, buttons = true }: PermissionRowProps) {
	const pending = !ev.resolved && agent.pendingPermissions.some(p => p.requestId === ev.requestId)
	const r = resolution(ev)
	return (
		<div className={[t.perm, pending ? t.permPending : t[r.tone], enter && t.enter].filter(Boolean).join(' ')} data-perm={ev.requestId}>
			<Icon name="shield" size={13} className={t.rowIcon} />
			<span className={t.permTitle} title={ev.title}>
				{ev.title}
			</span>
			{durationMs !== undefined && durationMs !== null && <span className={t.toolTime}>{formatMs(durationMs)}</span>}
			{pending && buttons ? (
				<PermissionButtons agentId={agent.id} requestId={ev.requestId} />
			) : (
				<span className={t.permResult}>{pending ? 'ждёт вас' : r.text}</span>
			)}
		</div>
	)
})
