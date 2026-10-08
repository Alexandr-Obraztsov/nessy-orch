import { openFeed } from '@/shared/model'
import { Icon } from '@/shared/ui'
import s from './AgentChat.module.css'

/** Агента больше нет (удалён). */
export function ChatNotFound({ id }: { id: string }) {
	return (
		<div className={s.notFound}>
			<Icon name="user" size={28} className={s.nfIcon} />
			<p className={s.nfText}>
				Агент <code>{id}</code> удалён. Его сообщения остались в ленте.
			</p>
			<button type="button" className={s.act} onClick={openFeed}>
				<Icon name="feed" size={13} />
				Открыть ленту
			</button>
		</div>
	)
}
