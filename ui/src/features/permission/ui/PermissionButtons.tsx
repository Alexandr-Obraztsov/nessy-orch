import { Icon } from '@/shared/ui'
import type { PermissionButtonsProps } from '../model/types'
import { usePermission } from '../model/usePermission'
import s from './PermissionButtons.module.css'

/** Компактные «Разрешить» / «Отклонить» для запроса разрешения агента. */
export function PermissionButtons({ agentId, requestId }: PermissionButtonsProps) {
	const p = usePermission(agentId, requestId)
	return (
		<div className={s.row}>
			<button
				type="button"
				className={[s.btn, s.approve].join(' ')}
				disabled={p.busy !== null}
				aria-busy={p.busy === 'approve'}
				onClick={() => void p.resolve('approve')}
			>
				{p.busy === 'approve' ? <span className={s.spin} /> : <Icon name="check" size={13} />}
				Разрешить
			</button>
			<button
				type="button"
				className={s.btn}
				disabled={p.busy !== null}
				aria-busy={p.busy === 'deny'}
				onClick={() => void p.resolve('deny')}
			>
				{p.busy === 'deny' ? <span className={s.spin} /> : <Icon name="x" size={13} />}
				Отклонить
			</button>
		</div>
	)
}
