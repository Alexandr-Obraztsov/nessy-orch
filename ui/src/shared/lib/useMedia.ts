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

/** Брейкпоинт раскладки: < 900px — одна колонка с нижними вкладками. */
export const NARROW = '(max-width: 899px)'

/** Средняя ширина: граф | панель, ростер — выдвижной. */
export const MEDIUM = '(min-width: 900px) and (max-width: 1279px)'
