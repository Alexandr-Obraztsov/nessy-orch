/**
 * Значок состояния агента (форма + цвет, различим и без цвета): ✻ работает (вращается и дышит),
 * ⚠ ждёт разрешения (мягкий пульс), ✓ выполнено (галочка дорисовывается), ✕ ошибка, ○ ждёт поручения.
 * Смена состояния — crossfade: прежний значок тает, новый проявляется на его месте.
 */
import { useEffect, useRef, useState } from 'react'
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

const FADE_MS = 220

export function StatusGlyph({ state, size = 16, className, label }: StatusGlyphProps) {
	const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const }
	const [prev, setPrev] = useState<AgentState | null>(null)
	const last = useRef(state)
	useEffect(() => {
		if (last.current === state) return
		setPrev(last.current)
		last.current = state
		const t = window.setTimeout(() => setPrev(null), FADE_MS)
		return () => window.clearTimeout(t)
	}, [state])
	return (
		<span className={[s.g, className].filter(Boolean).join(' ')} data-state={state} style={{ width: size, height: size, fontSize: size }} {...a11y}>
			{prev !== null && prev !== state && (
				<span key={`out-${prev}`} className={s.layer} data-out="">
					<Glyph state={prev} />
				</span>
			)}
			<span key={state} className={s.layer} data-in={prev !== null || undefined}>
				<Glyph state={state} />
			</span>
		</span>
	)
}

function Glyph({ state }: { state: AgentState }) {
	if (state === 'working' || state === 'starting') return <Sparkle tone={state === 'starting' ? 'dim' : 'accent'} motion="spin" />
	return (
		<svg viewBox="0 0 16 16" fill="none" strokeLinecap="round" strokeLinejoin="round" data-state={state}>
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
	)
}
