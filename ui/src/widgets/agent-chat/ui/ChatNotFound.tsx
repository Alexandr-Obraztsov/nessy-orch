import { closeAgent } from '@/shared/model'
import { Button } from '@/shared/ui'
import s from './AgentChat.module.css'

/** Агента больше нет (удалён). */
export function ChatNotFound({ id }: { id: string }) {
	return (
		<div className={s.notFound}>
			<div className={s.ghost} aria-hidden="true">
				?
			</div>
			<p className={s.nfTitle}>Агент не найден</p>
			<p className={s.nfText}>
				Похоже, агент <code>{id}</code> был удалён. Его сообщения остались в общей ленте.
			</p>
			<Button variant="secondary" size="sm" icon="chevronLeft" onClick={closeAgent}>
				К общей ленте
			</Button>
		</div>
	)
}
