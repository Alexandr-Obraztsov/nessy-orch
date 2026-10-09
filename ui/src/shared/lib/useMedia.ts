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

/** Узкий экран: сайдбар выезжает поверх, окно агента — лист снизу. */
export const NARROW = '(max-width: 899px)'
