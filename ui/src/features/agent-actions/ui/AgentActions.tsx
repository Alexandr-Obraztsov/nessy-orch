/**
 * Действия в шапке чата агента: «Прервать» (пока идёт ход) и меню «⋯» (прервать / копировать id / удалить).
 */
import { useEffect, useRef, useState } from 'react'
import { canCancel } from '@/entities/agent'
import { Icon, IconButton } from '@/shared/ui'
import { cancelTurn, copyText } from '../model/actions'
import type { AgentActionsProps } from '../model/types'
import s from './AgentActions.module.css'
import { ConfirmDelete } from './ConfirmDelete'

export function AgentActions({ agent }: AgentActionsProps) {
	const [menu, setMenu] = useState(false)
	const [confirm, setConfirm] = useState(false)
	const [cancelling, setCancelling] = useState(false)
	const box = useRef<HTMLDivElement>(null)
	const cancellable = canCancel(agent.status)

	useEffect(() => {
		if (!menu) return
		const onDown = (e: MouseEvent): void => {
			if (!box.current?.contains(e.target as Node)) setMenu(false)
		}
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				e.stopPropagation()
				setMenu(false)
			}
		}
		document.addEventListener('mousedown', onDown)
		window.addEventListener('keydown', onKey, true)
		return () => {
			document.removeEventListener('mousedown', onDown)
			window.removeEventListener('keydown', onKey, true)
		}
	}, [menu])

	const cancel = async (): Promise<void> => {
		setMenu(false)
		setCancelling(true)
		await cancelTurn(agent.id)
		setCancelling(false)
	}

	return (
		<div className={s.actions} ref={box}>
			{cancellable && (
				<IconButton
					icon="stop"
					label="Прервать ход"
					size="sm"
					className={s.stop}
					loading={cancelling}
					onClick={() => void cancel()}
				/>
			)}
			<IconButton icon="dots" label="Действия" size="sm" aria-expanded={menu} onClick={() => setMenu(v => !v)} />
			{menu && (
				<div className={s.menu} role="menu">
					<button type="button" role="menuitem" disabled={!cancellable} onClick={() => void cancel()}>
						<Icon name="stop" size={15} />
						Прервать ход
					</button>
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							setMenu(false)
							void copyText(agent.id, `id скопирован: ${agent.id}`)
						}}
					>
						<Icon name="copy" size={15} />
						Копировать id
						<code>{agent.id}</code>
					</button>
					<div className={s.sep} />
					<button
						type="button"
						role="menuitem"
						className={s.danger}
						onClick={() => {
							setMenu(false)
							setConfirm(true)
						}}
					>
						<Icon name="trash" size={15} />
						Удалить агента…
					</button>
				</div>
			)}
			<ConfirmDelete agent={agent} open={confirm} onClose={() => setConfirm(false)} />
		</div>
	)
}
