/**
 * Иконка состояния: форма + цвет (различима без цвета). Вращение — только у «работает»,
 * пульс — только у «ждёт вас». При prefers-reduced-motion анимаций нет.
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

function Glyph({ state }: { state: AgentState }) {
	switch (state) {
		case 'wait':
			return (
				<>
					<path d="M8 1.8 15 14H1z" fill="currentColor" fillOpacity=".2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
					<path d="M8 6.2v3.6M8 11.6v.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
				</>
			)
		case 'error':
			return (
				<>
					<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="3" fill="currentColor" fillOpacity=".18" stroke="currentColor" strokeWidth="1.5" />
					<path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
				</>
			)
		case 'working':
			return (
				<>
					<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" />
					<path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
				</>
			)
		case 'starting':
			return <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.4 2.4" />
		case 'idle':
			return <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
		case 'done':
			return (
				<>
					<circle cx="8" cy="8" r="6.2" fill="currentColor" fillOpacity=".18" stroke="currentColor" strokeWidth="1.5" />
					<path d="m5 8.2 2.2 2.2L11 6.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
				</>
			)
	}
}

export function StatusIcon({ state, size = 16, className, label }: StatusIconProps) {
	return (
		<span
			className={[s.ic, s[state], className].filter(Boolean).join(' ')}
			style={{ width: size, height: size }}
			role={label ? 'img' : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
		>
			<svg viewBox="0 0 16 16">
				<Glyph state={state} />
			</svg>
		</span>
	)
}
