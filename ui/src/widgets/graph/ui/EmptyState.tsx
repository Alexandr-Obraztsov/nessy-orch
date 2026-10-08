/** Пустой экран сонара: только «Вы» и приглашение запустить первого агента. */
import { openDialog } from '@/shared/model'
import { Button } from '@/shared/ui'
import o from './Overlays.module.css'

export function EmptyState() {
	return (
		<div className={o.empty}>
			<h2 className={o.emptyTitle}>Пока нет агентов</h2>
			<p className={o.emptyText}>Запустите первого — он появится отметкой на экране сонара.</p>
			<Button variant="primary" icon="plus" onClick={() => openDialog('spawn')}>
				Запустить агента
			</Button>
			<span className={o.emptyHint}>
				или нажмите <kbd>N</kbd>
			</span>
		</div>
	)
}
