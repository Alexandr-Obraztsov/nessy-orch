export interface PermissionButtonsProps {
	agentId: string
	requestId: string
}

export type PermissionChoice = 'approve' | 'deny'

export interface PermissionModel {
	/** какая кнопка сейчас отправляется */
	busy: PermissionChoice | null
	resolve: (choice: PermissionChoice) => Promise<void>
}
