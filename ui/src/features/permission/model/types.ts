export interface PermissionButtonsProps {
	agentId: string
	requestId: string
	/** компактный вариант (баннер) */
	compact?: boolean
}

export type PermissionChoice = 'approve' | 'deny'

export interface PermissionModel {
	/** какая кнопка сейчас отправляется */
	busy: PermissionChoice | null
	resolve: (choice: PermissionChoice) => Promise<void>
}
