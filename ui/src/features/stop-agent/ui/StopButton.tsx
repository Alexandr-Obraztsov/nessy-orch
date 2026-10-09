import { ActionButton } from '@/shared/ui'
import type { StopButtonProps } from '../model/types'
import { useStop } from '../model/useStop'

/** Кнопка «Остановить» с подтверждением вторым кликом. Клик не всплывает к строке таблицы. */
export function StopButton({ agentId, size = 'sm', iconOnly, className }: StopButtonProps) {
	const m = useStop(agentId)
	const label = m.armed ? 'Точно?' : 'Остановить'
	return (
		<ActionButton
			tone={m.armed ? 'danger' : 'plain'}
			size={size}
			icon="stop"
			className={className}
			busy={m.busy}
			disabled={m.busy}
			title={m.armed ? 'Нажмите ещё раз, чтобы остановить ход' : 'Остановить ход агента'}
			aria-label={label}
			data-act="stop"
			onClick={e => {
				e.stopPropagation()
				m.press()
			}}
		>
			{iconOnly && !m.armed ? undefined : label}
		</ActionButton>
	)
}
