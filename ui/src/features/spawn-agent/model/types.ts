/** Поля формы запуска агента, к которым привязываются ошибки сервера. */
export type SpawnField = 'space' | 'name' | 'role' | 'form'

export type SpawnErrors = Partial<Record<SpawnField, string>>

export interface SpawnFormState {
	/** имя пространства или OTHER_PATH */
	space: string
	path: string
	name: string
	/** id роли или '' — без роли */
	role: string
	prompt: string
}
