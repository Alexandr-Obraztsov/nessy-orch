/**
 * Значок состояния агента (форма + цвет, различим и без цвета): ✻ работает (искорка Claude),
 * ⚠ ждёт разрешения (мягкий пульс), ✓ выполнено (галочка дорисовывается), ✕ ошибка, ○ ждёт поручения.
 */
import { Sparkle } from '@/shared/ui'
import type { AgentState } from '../lib/state.types'
import s from './StatusGlyph.module.css'

export interface StatusGlyphProps {
	state: AgentState
	size?: number
	className?: string
	/** подпись для экранных читалок (иначе значок скрыт) */
	label?: string
}

export function StatusGlyph({ state, size = 16, className, label }: StatusGlyphProps) {
	const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const }
	return (
		<span className={[s.g, className].filter(Boolean).join(' ')} data-state={state} style={{ width: size, height: size, fontSize: size }} {...a11y}>
			{state === 'working' || state === 'starting' ? (
				<Sparkle tone={state === 'starting' ? 'dim' : 'accent'} />
			) : (
				<svg viewBox="0 0 16 16" fill="none" strokeLinecap="round" strokeLinejoin="round">
					{state === 'done' && <path className={s.check} d="M3.5 8.4l2.9 2.9 6-6.4" />}
					{state === 'error' && <path className={s.cross} d="M4.5 4.5l7 7M11.5 4.5l-7 7" />}
					{state === 'wait' && (
						<>
							<path className={s.tri} d="M8 2.2l6.2 11H1.8z" />
							<path className={s.bang} d="M8 6.6v3M8 11.6v.1" />
						</>
					)}
					{state === 'idle' && <circle className={s.ring} cx="8" cy="8" r="4.6" />}
				</svg>
			)}
		</span>
	)
}
