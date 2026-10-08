/** Маленький индикатор связи с оркестратором (подробности — в верхней панели). */
import type { Conn } from '@/shared/model'
import { Icon } from '@/shared/ui'
import o from './Overlays.module.css'

export function ConnBadge({ conn }: { conn: Conn }) {
	if (conn === 'live') return null
	const offline = conn === 'offline'
	return (
		<div className={`${o.conn} ${o.glass} ${offline ? o.connOffline : ''}`} role="status">
			{offline ? <Icon name="wifiOff" size={13} /> : <span className={o.connDot} />}
			{offline ? 'нет связи' : 'подключение…'}
		</div>
	)
}
