/** Поля формы запуска агента, к которым привязываются ошибки сервера. */
export type SpawnField = 'space' | 'name' | 'form'

export type SpawnErrors = Partial<Record<SpawnField, string>>

export interface SpawnFormState {
	/** имя пространства или OTHER_PATH */
	space: string
	path: string
	name: string
	prompt: string
}
