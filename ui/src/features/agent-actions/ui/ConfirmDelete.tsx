import { useState } from 'react'
import { Button, Dialog } from '@/shared/ui'
import { removeAgent } from '../model/actions'
import type { ConfirmDeleteProps } from '../model/types'
import s from './AgentActions.module.css'

/** Подтверждение удаления агента. */
export function ConfirmDelete({ agent, open, onClose }: ConfirmDeleteProps) {
	const [busy, setBusy] = useState(false)
	const run = async (): Promise<void> => {
		setBusy(true)
		const ok = await removeAgent(agent.id, agent.name)
		setBusy(false)
		if (ok) onClose()
	}
	return (
		<Dialog
			open={open}
			title={`Удалить агента ${agent.name}?`}
			subtitle="Сессия nessy будет остановлена, агент исчезнет из графа."
			onClose={onClose}
			footer={
				<>
					<Button variant="ghost" onClick={onClose}>
						Отмена
					</Button>
					<Button variant="danger" icon="trash" loading={busy} onClick={() => void run()}>
						Удалить
					</Button>
				</>
			}
		>
			<p className={s.confirmText}>
				{agent.status === 'working' ? 'Агент сейчас работает — текущий ход будет прерван. ' : ''}
				История сообщений в общей ленте сохранится.
			</p>
			<code className={s.confirmId}>
				{agent.id} · {agent.space}
			</code>
		</Dialog>
	)
}
