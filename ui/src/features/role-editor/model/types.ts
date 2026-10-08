export interface RoleDraft {
	name: string
	description: string
	instructions: string
	color: number
}

export type RoleField = 'name' | 'description' | 'instructions' | 'form'

export type RoleErrors = Partial<Record<RoleField, string>>

export interface RoleEditorProps {
	/** id роли; null — новая роль */
	id: string | null
}
