export interface MarkdownBodyProps {
	text: string
	/** текст ещё дописывается — мигающая каретка в конце */
	streaming?: boolean
	className?: string
}

export interface SystemLineProps {
	text: string
	level?: 'info' | 'error'
	/** время события (уже отформатированное) */
	time?: string
	enter?: boolean
}

export interface JumpToLatestProps {
	visible: boolean
	/** сколько новых пришло, пока пользователь был выше */
	unseen: number
	onClick: () => void
}

export interface NodeLinkProps {
	/** `you`, `system` или id агента */
	id: string
	strong?: boolean
}
