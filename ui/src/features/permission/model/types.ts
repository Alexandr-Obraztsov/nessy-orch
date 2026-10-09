export interface PermissionButtonsProps {
	agentId: string
	requestId: string
	/** sm — в строке таблицы и в панели, lg — крупные кнопки на телефоне */
	size?: 'sm' | 'lg'
	className?: string
}

export type PermissionChoice = 'approve' | 'deny'

export interface PermissionModel {
	/** какая кнопка сейчас отправляется */
	busy: PermissionChoice | null
	/** последний успешно отправленный ответ (для анимации отклика) */
	sent: PermissionChoice | null
	resolve: (choice: PermissionChoice) => Promise<void>
}
