import s from './AgentChat.module.css'

/** Заглушка, пока проигрывается история агента. */
export function ChatSkeleton() {
	return (
		<div className={s.skeleton} aria-busy="true" aria-label="Загрузка истории">
			<i className={s.skOut} style={{ width: '40%' }} />
			<i style={{ width: '78%', height: 44 }} />
			<i style={{ width: '52%', height: 14 }} />
			<i style={{ width: '60%', height: 14 }} />
			<i style={{ width: '84%', height: 60 }} />
		</div>
	)
}
