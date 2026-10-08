import { useSyncExternalStore } from 'react'

/** Реактивный media query. */
export function useMedia(query: string): boolean {
	return useSyncExternalStore(
		fn => {
			const m = window.matchMedia(query)
			m.addEventListener('change', fn)
			return () => m.removeEventListener('change', fn)
		},
		() => window.matchMedia(query).matches,
	)
}

/** Брейкпоинт раскладки: < 900px — верхняя панель, левая панель выезжает поверх. */
export const NARROW = '(max-width: 899px)'

