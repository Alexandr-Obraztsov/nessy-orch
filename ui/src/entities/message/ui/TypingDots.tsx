import s from './TypingDots.module.css'

/** «Печатает…» — три пульсирующие точки. */
export function TypingDots({ label = 'печатает' }: { label?: string }) {
	return (
		<span className={s.dots} role="status" aria-label={label}>
			<i />
			<i />
			<i />
		</span>
	)
}
