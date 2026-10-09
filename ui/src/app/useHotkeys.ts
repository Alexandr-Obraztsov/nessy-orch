import { useEffect } from 'react'
import { getView, openPage, setDrawer } from '@/shared/model'

const isField = (t: EventTarget | null): boolean =>
	t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/**
 * Esc вне полей ввода: закрыть выехавший сайдбар, со справочника — вернуться к задачам.
 * Окно агента и диалоги закрываются сами (они перехватывают Esc раньше).
 */
export function useHotkeys(): void {
	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.key !== 'Escape' || e.defaultPrevented || isField(e.target)) return
			const v = getView()
			if (v.dialog || v.agentId || document.querySelector('[role="dialog"]')) return
			if (v.drawer) setDrawer(false)
			else if (v.page.kind !== 'main') openPage({ kind: 'main' })
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])
}
