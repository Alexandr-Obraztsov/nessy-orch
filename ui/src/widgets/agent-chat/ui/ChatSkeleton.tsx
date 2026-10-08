import s from './AgentChat.module.css'

/** Заглушка, пока проигрывается история агента. */
export function ChatSkeleton() {
	return (
		<div className={s.skeleton} aria-busy="true" aria-label="Загрузка истории">
			<i className={s.skOut} style={{ width: '46%' }} />
			<i style={{ width: '72%', height: 54 }} />
			<i style={{ width: '58%' }} />
			<i className={s.skOut} style={{ width: '38%' }} />
			<i style={{ width: '80%', height: 72 }} />
		</div>
	)
}
