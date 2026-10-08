/** Последний адресат из ленты — общий для всех экземпляров composer за сессию. */
let last: string | null = null

export const getLastRecipient = (): string | null => last
export const setLastRecipient = (id: string): void => {
	last = id
}
