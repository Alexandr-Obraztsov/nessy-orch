export type SpaceField = 'path' | 'name' | 'url' | 'form'

export type SpaceErrors = Partial<Record<SpaceField, string>>

export interface SpaceFormState {
	path: string
	name: string
	external: boolean
	url: string
}
