import s from './DaySeparator.module.css'

/** Разделитель дней («Сегодня», «Вчера», «12 октября») — тонкая линия с подписью. */
export function DaySeparator({ label }: { label: string }) {
	return (
		<div className={s.sep} role="separator" aria-label={label}>
			<span className={s.label}>{label}</span>
		</div>
	)
}
