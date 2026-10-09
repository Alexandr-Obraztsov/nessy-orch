import type { MouseEvent } from 'react'
import { ActionButton } from '@/shared/ui'
import type { PermissionButtonsProps } from '../model/types'
import { usePermission } from '../model/usePermission'

/**
 * «Разрешить» / «Отклонить» для запроса разрешения агента. Клик не всплывает к строке таблицы.
 * Отправленный ответ отмечается микро-анимацией, пока запрос не исчезнет из данных агента.
 */
export function PermissionButtons({ agentId, requestId, size = 'sm', className }: PermissionButtonsProps) {
	const p = usePermission(agentId, requestId)
	const click = (choice: 'approve' | 'deny') => (e: MouseEvent): void => {
		e.stopPropagation()
		void p.resolve(choice)
	}
	const locked = p.busy !== null || p.sent !== null
	return (
		<>
			<ActionButton
				tone="ok"
				size={size}
				icon="check"
				className={className}
				busy={p.busy === 'approve'}
				pulse={p.sent === 'approve' ? 'pop' : null}
				disabled={locked}
				onClick={click('approve')}
				data-act="allow"
			>
				{p.sent === 'approve' ? 'Разрешено' : 'Разрешить'}
			</ActionButton>
			<ActionButton
				size={size}
				icon="x"
				className={className}
				busy={p.busy === 'deny'}
				pulse={p.sent === 'deny' ? 'shake' : null}
				disabled={locked}
				onClick={click('deny')}
				aria-label="Отклонить"
				title="Отклонить"
				data-act="deny"
			>
				Отклонить
			</ActionButton>
		</>
	)
}
