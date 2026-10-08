import { Button } from '@/shared/ui'
import type { PermissionButtonsProps } from '../model/types'
import { usePermission } from '../model/usePermission'
import s from './PermissionButtons.module.css'

export function PermissionButtons({ agentId, requestId, compact }: PermissionButtonsProps) {
	const p = usePermission(agentId, requestId)
	return (
		<div className={s.row}>
			<Button
				variant="primary"
				size="sm"
				icon="check"
				loading={p.busy === 'approve'}
				disabled={p.busy !== null}
				onClick={() => void p.resolve('approve')}
			>
				Разрешить
			</Button>
			<Button
				variant={compact ? 'ghost' : 'secondary'}
				size="sm"
				icon="x"
				loading={p.busy === 'deny'}
				disabled={p.busy !== null}
				onClick={() => void p.resolve('deny')}
			>
				Отклонить
			</Button>
		</div>
	)
}
