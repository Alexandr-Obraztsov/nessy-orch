/**
 * Диалог подтверждения удаления агента (один на приложение, монтируется в App).
 */
import { useState } from 'react'
import { Button, Dialog } from '@/shared/ui'
import { removeAgent } from '../model/actions'
import { askRemove, usePendingRemove } from '../model/confirm'
import s from './AgentActions.module.css'

export function AgentConfirmHost() {
	const agent = usePendingRemove()
	const [busy, setBusy] = useState(false)
	if (!agent) return null
	const close = (): void => askRemove(null)
	const run = async (): Promise<void> => {
		setBusy(true)
		const ok = await removeAgent(agent.id, agent.name)
		setBusy(false)
		if (ok) close()
	}
	return (
		<Dialog
			open
			title={`Удалить агента ${agent.name}?`}
			subtitle="Сессия nessy будет остановлена и забыта. Чтобы просто убрать из списка — архивируйте."
			onClose={close}
			footer={
				<>
					<Button variant="ghost" onClick={close}>
						Отмена
					</Button>
					<Button variant="danger" icon="trash" loading={busy} onClick={() => void run()} data-autofocus>
						Удалить
					</Button>
				</>
			}
		>
			<p className={s.text}>
				{agent.status === 'working' ? 'Агент сейчас работает — текущий ход будет прерван. ' : ''}
				Сообщения в общей ленте сохранятся.
			</p>
			<code className={s.id}>
				{agent.id} · {agent.space}
			</code>
		</Dialog>
	)
}
