import { Icon } from '@/shared/ui'
import type { FeedEmptyProps } from '../model/types'
import s from './Feed.module.css'

/** Пустая лента: иконка и одна строка — что здесь появится. */
export function FeedEmpty({ hidden }: FeedEmptyProps) {
	return (
		<div className={s.empty}>
			<Icon name="feed" size={28} className={s.emptyIcon} />
			<p className={s.emptyText}>
				{hidden
					? 'Ваших сообщений и ответов агентов пока нет — остальное скрыто настройками ленты.'
					: 'Здесь появятся ваши сообщения и итоговые ответы агентов.'}
			</p>
		</div>
	)
}
