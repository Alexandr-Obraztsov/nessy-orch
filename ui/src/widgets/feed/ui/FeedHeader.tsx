import { setView, useView } from '@/shared/model'
import { FILTERS } from '../lib/filter'
import s from './Feed.module.css'

/** Шапка ленты: заголовок, счётчик, фильтр. */
export function FeedHeader({ count }: { count: number }) {
	const filter = useView(v => v.feedFilter)
	return (
		<header className={s.header}>
			<div className={s.titleBox}>
				<h2 className={s.title}>Общая лента</h2>
				<span className={s.count} title="Сообщений в фильтре">
					{count}
				</span>
			</div>
			<div className={s.segmented} role="tablist" aria-label="Фильтр ленты">
				{FILTERS.map(f => (
					<button
						key={f.id}
						type="button"
						role="tab"
						aria-selected={filter === f.id}
						title={f.hint}
						className={filter === f.id ? s.segOn : undefined}
						onClick={() => setView({ feedFilter: f.id })}
					>
						{f.label}
					</button>
				))}
			</div>
		</header>
	)
}
