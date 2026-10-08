import { openDialog } from '@/shared/model'
import { Button } from '@/shared/ui'
import s from './Roster.module.css'

/** Пустой ростер: нет агентов (и, возможно, пространств). */
export function RosterEmpty({ hasSpaces }: { hasSpaces: boolean }) {
	return (
		<div className={s.empty}>
			<div className={s.emptyScope} aria-hidden="true">
				<span />
				<span />
				<span />
				<i />
			</div>
			<h3 className={s.emptyTitle}>{hasSpaces ? 'На экране пусто' : 'Начните с пространства'}</h3>
			<p className={s.emptyText}>
				{hasSpaces
					? 'Запустите агента — он появится здесь и на графе.'
					: 'Пространство — рабочая папка, где живут агенты. Можно сразу запустить агента по пути.'}
			</p>
			<div className={s.emptyActions}>
				{!hasSpaces && (
					<Button icon="layers" onClick={() => openDialog('space')}>
						Пространство
					</Button>
				)}
				<Button variant="primary" icon="plus" onClick={() => openDialog('spawn')}>
					Агент
				</Button>
			</div>
		</div>
	)
}
