/**
 * Иконка состояния агента: форма + цвет (различима и без цвета). Все части SVG нарисованы всегда,
 * состояние только переключает их видимость — поэтому смена состояния анимируется: галочка
 * «дорисовывается», крестик проявляется, кольцо заливается. Вращение — у «работает»,
 * пульс — у «ждёт разрешения». При prefers-reduced-motion анимаций нет.
 */
import type { AgentState } from '../lib/state.types'
import s from './StatusIcon.module.css'

export interface StatusIconProps {
	state: AgentState
	size?: number
	className?: string
	/** подпись для экранных читалок (иначе иконка скрыта) */
	label?: string
}

export function StatusIcon({ state, size = 20, className, label }: StatusIconProps) {
	return (
		<span
			className={[s.ic, className].filter(Boolean).join(' ')}
			data-state={state}
			style={{ width: size, height: size }}
			role={label ? 'img' : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
		>
			<svg viewBox="0 0 20 20">
				<circle className={s.ping} cx="10" cy="10" r="3" />
				<circle className={s.ring} cx="10" cy="10" r="8" />
				<circle className={s.spin} cx="10" cy="10" r="8" />
				<circle className={s.dot} cx="10" cy="10" r="3.2" />
				<path className={s.check} d="M6 10.3l2.9 2.9L14 7.4" />
				<path className={s.cross} d="M7.2 7.2l5.6 5.6M12.8 7.2l-5.6 5.6" />
			</svg>
		</span>
	)
}
