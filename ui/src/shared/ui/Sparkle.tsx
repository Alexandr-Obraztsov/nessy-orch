/**
 * Индикатор работы как у Claude Code: «искорка» ✻, перебирающая начертания (· ✢ ✳ ✶ ✻ ✽),
 * и мерцающий текст «Работает…». При prefers-reduced-motion — статичная ✻.
 */
import type { ReactNode } from 'react'
import s from './Sparkle.module.css'

export interface SparkleProps {
	/** dim — приглушённая (запуск), иначе цвет акцента */
	tone?: 'accent' | 'dim' | 'inherit'
	size?: number
	className?: string
}

export function Sparkle({ tone = 'accent', size, className }: SparkleProps) {
	return (
		<span
			className={[s.sp, className].filter(Boolean).join(' ')}
			data-tone={tone}
			style={size ? { fontSize: size } : undefined}
			aria-hidden="true"
		/>
	)
}

/** Мерцающий текст (волна света по тексту), как «✻ Working…» в Claude Code. */
export function Shimmer({ children, className }: { children: ReactNode; className?: string }) {
	return <span className={[s.shimmer, className].filter(Boolean).join(' ')}>{children}</span>
}
