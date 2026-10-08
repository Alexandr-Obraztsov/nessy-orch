/**
 * Меню «⋯» агента: открыть, прервать ход, архив/возврат, копировать id, удалить.
 * Можно управлять открытием снаружи (правый клик по строке списка).
 */
import { useState } from 'react'
import { openAgent } from '@/shared/model'
import { IconButton, MenuItem, MenuSeparator, Popover } from '@/shared/ui'
import type { AgentMenuProps } from '../model/types'
import { useAgentActions } from '../model/useAgentActions'

export function AgentMenu({ agent, align = 'end', size = 'sm', className, open, onOpenChange, showOpen }: AgentMenuProps) {
	const [own, setOwn] = useState(false)
	const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
	const isOpen = open ?? own
	const setOpen = (v: boolean): void => {
		setOwn(v)
		onOpenChange?.(v)
	}
	const act = useAgentActions(agent)
	const run = (fn: () => unknown) => (): void => {
		setOpen(false)
		void fn()
	}

	return (
		<>
			<IconButton
				ref={setAnchor}
				icon="dots"
				label={`Действия: ${agent.name}`}
				size={size}
				className={className}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				onClick={e => {
					e.stopPropagation()
					setOpen(!isOpen)
				}}
			/>
			<Popover open={isOpen} anchor={anchor} onClose={() => setOpen(false)} align={align} label={`Действия: ${agent.name}`} role="menu">
				{showOpen && (
					<MenuItem icon="chat" onClick={run(() => openAgent(agent.id))}>
						Открыть
					</MenuItem>
				)}
				{act.cancellable && (
					<MenuItem icon="stop" disabled={act.busy} onClick={run(act.cancel)}>
						Прервать ход
					</MenuItem>
				)}
				{agent.archived ? (
					<MenuItem icon="restore" disabled={act.busy} onClick={run(act.restore)}>
						Вернуть из архива
					</MenuItem>
				) : (
					<MenuItem icon="archive" disabled={act.busy} onClick={run(act.archive)}>
						Архивировать
					</MenuItem>
				)}
				<MenuItem icon="copy" hint={agent.id.length > 14 ? undefined : agent.id} onClick={run(act.copyId)}>
					Копировать id
				</MenuItem>
				<MenuSeparator />
				<MenuItem icon="trash" danger onClick={run(() => act.remove(true))}>
					Удалить…
				</MenuItem>
			</Popover>
		</>
	)
}
