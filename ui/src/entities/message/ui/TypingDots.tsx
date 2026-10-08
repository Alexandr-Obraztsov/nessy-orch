import s from './TypingDots.module.css'

/** «Работает…» — три пульсирующие точки. */
export function TypingDots({ label = 'работает' }: { label?: string }) {
	return (
		<span className={s.dots} role="status" aria-label={label}>
			<i />
			<i />
			<i />
		</span>
	)
}
