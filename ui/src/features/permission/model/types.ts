export interface PermissionButtonsProps {
	agentId: string
	requestId: string
	/** sm — в строке списка (по умолчанию), md — крупные кнопки в деталях */
	size?: 'sm' | 'md'
	className?: string
}

export type PermissionChoice = 'approve' | 'deny'

export interface PermissionModel {
	/** какая кнопка сейчас отправляется */
	busy: PermissionChoice | null
	resolve: (choice: PermissionChoice) => Promise<void>
}
