import s from './DaySeparator.module.css'

/** Разделитель дней в ленте («Сегодня», «Вчера», «12 октября»). */
export function DaySeparator({ label }: { label: string }) {
	return (
		<div className={s.sep} role="separator">
			<span className={s.label}>{label}</span>
		</div>
	)
}
