import { setView } from '@/shared/model'
import { Button } from '@/shared/ui'
import s from './Feed.module.css'

/** Пустая лента: «экран сонара» и подсказка, что делать. */
export function FeedEmpty({ filtered, hasAgents }: { filtered: boolean; hasAgents: boolean }) {
	return (
		<div className={s.empty}>
			<div className={s.sonar} aria-hidden="true">
				<i />
				<i />
				<i />
				<b />
			</div>
			{filtered ? (
				<>
					<p className={s.emptyTitle}>В этом фильтре пусто</p>
					<Button size="sm" variant="secondary" onClick={() => setView({ feedFilter: 'all' })}>
						Показать все
					</Button>
				</>
			) : (
				<>
					<p className={s.emptyTitle}>Эфир пока тих</p>
					<p className={s.emptyText}>
						{hasAgents
							? 'Напишите агенту ниже — здесь появится переписка: ваши сообщения, ответы и разговоры агентов между собой.'
							: 'Здесь появится переписка с агентами. Запустите первого агента — кнопка внизу.'}
					</p>
				</>
			)}
		</div>
	)
}
