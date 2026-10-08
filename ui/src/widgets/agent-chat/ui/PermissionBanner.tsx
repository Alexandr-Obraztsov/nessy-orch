import type { AgentView } from '@contract'
import { PermissionButtons } from '@/features/permission'
import { Icon } from '@/shared/ui'
import s from './AgentChat.module.css'

/** Баннер над чатом: агент ждёт разрешения. */
export function PermissionBanner({ agent }: { agent: AgentView }) {
	if (agent.pendingPermissions.length === 0) return null
	return (
		<div className={s.banner} role="alert">
			{agent.pendingPermissions.map(p => (
				<div key={p.requestId} className={s.bannerItem}>
					<Icon name="shield" size={16} className={s.bannerIcon} />
					<div className={s.bannerText}>
						<b>Ждёт разрешения</b>
						<span>{p.title}</span>
					</div>
					<PermissionButtons agentId={agent.id} requestId={p.requestId} compact />
				</div>
			))}
		</div>
	)
}
