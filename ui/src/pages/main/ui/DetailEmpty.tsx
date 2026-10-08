/** Правая колонка, когда агент не выбран: подсказка и горячие клавиши. */
import { Kbd } from '@/shared/ui'
import s from './MainPage.module.css'

const KEYS: Array<[string[], string]> = [
	[['j', 'k'], 'по строкам'],
	[['Enter'], 'открыть детали'],
	[['a'], 'разрешить запрос'],
	[['x'], 'прервать ход'],
	[['/'], 'поиск'],
	[['n'], 'новое поручение'],
	[['Esc'], 'закрыть детали'],
]

export function DetailEmpty() {
	return (
		<div className={s.dEmptyWrap}>
			<div className={s.dHead}>
				<h2>Детали агента</h2>
			</div>
			<div className={s.dEmpty}>
				<h3>Выберите агента</h3>
				<p>Клик по строке агента или элементу «Внимание» откроет здесь «Сейчас», план, результат, шаги и чат.</p>
				<div className={s.keys}>
					{KEYS.map(([keys, label]) => (
						<div key={label} className={s.key}>
							<span className={s.kbds}>
								{keys.map(k => (
									<Kbd key={k}>{k}</Kbd>
								))}
							</span>
							<span>{label}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}
