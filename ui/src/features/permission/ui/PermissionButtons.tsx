import type { MouseEvent } from 'react'
import { Icon } from '@/shared/ui'
import type { PermissionButtonsProps } from '../model/types'
import { usePermission } from '../model/usePermission'
import s from './PermissionButtons.module.css'

/** «Разрешить» / «Отклонить» для запроса разрешения агента. Клик не всплывает к строке-карточке. */
export function PermissionButtons({ agentId, requestId, size = 'sm', className }: PermissionButtonsProps) {
	const p = usePermission(agentId, requestId)
	const click = (choice: 'approve' | 'deny') => (e: MouseEvent): void => {
		e.stopPropagation()
		void p.resolve(choice)
	}
	return (
		<div className={[s.row, size === 'md' && s.md, className].filter(Boolean).join(' ')}>
			<button
				type="button"
				className={[s.btn, s.approve].join(' ')}
				disabled={p.busy !== null}
				aria-busy={p.busy === 'approve'}
				onClick={click('approve')}
			>
				{p.busy === 'approve' ? <span className={s.spin} /> : <Icon name="check" size={13} strokeWidth={2.2} />}
				Разрешить
			</button>
			<button
				type="button"
				className={[s.btn, s.deny].join(' ')}
				disabled={p.busy !== null}
				aria-busy={p.busy === 'deny'}
				onClick={click('deny')}
			>
				{p.busy === 'deny' ? <span className={s.spin} /> : <Icon name="x" size={13} strokeWidth={2.2} />}
				Отклонить
			</button>
		</div>
	)
}
