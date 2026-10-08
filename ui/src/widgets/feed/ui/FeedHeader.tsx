import { setFeedOptions, useView } from '@/shared/model'
import type { FeedHeaderProps, FeedToggle } from '../model/types'
import s from './Feed.module.css'

const TOGGLES: FeedToggle[] = [
	{ key: 'agentChatter', label: 'Переписка агентов', hint: 'Показывать сообщения агентов друг другу' },
	{ key: 'system', label: 'Системные', hint: 'Показывать системные события: создан, в архиве, ошибки доставки' },
]

/** Шапка ленты: заголовок, счётчик, переключатели «Переписка агентов» и «Системные». */
export function FeedHeader({ count }: FeedHeaderProps) {
	const opts = useView(v => v.feed)
	return (
		<header className={s.header}>
			<div className={s.headerInner}>
				<h2 className={s.title}>Лента</h2>
				<span className={s.count} title="Сообщений в ленте">
					{count}
				</span>
				<div className={s.toggles} role="group" aria-label="Что показывать">
					{TOGGLES.map(t => (
						<button
							key={t.key}
							type="button"
							className={s.toggle}
							aria-pressed={opts[t.key]}
							title={t.hint}
							onClick={() => setFeedOptions({ [t.key]: !opts[t.key] })}
						>
							{t.label}
						</button>
					))}
				</div>
			</div>
		</header>
	)
}
