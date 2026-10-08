import type { AgentView } from '@contract'

export interface AgentActionsApi {
	/** прервать текущий ход */
	cancel: () => Promise<boolean>
	/** убрать в архив (сессия сохраняется) */
	archive: () => Promise<boolean>
	/** вернуть из архива */
	restore: () => Promise<boolean>
	/** удалить; confirm=true (по умолчанию) — сначала спросить в диалоге */
	remove: (confirm?: boolean) => Promise<boolean>
	/** скопировать id агента */
	copyId: () => Promise<void>
	/** идёт ли запрос (кнопки блокируются) */
	busy: boolean
	/** можно ли прервать ход сейчас */
	cancellable: boolean
}

export interface AgentMenuProps {
	agent: AgentView
	/** выравнивание меню относительно кнопки */
	align?: 'start' | 'end'
	/** размер кнопки «⋯» */
	size?: 'sm' | 'md'
	className?: string
	/** управляемое открытие (например, по правому клику на строке) */
	open?: boolean
	onOpenChange?: (open: boolean) => void
	/** показать пункт «Открыть» (в списках) */
	showOpen?: boolean
}

export interface AgentActionsProps {
	agent: AgentView
}
