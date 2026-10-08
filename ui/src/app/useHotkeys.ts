import { useEffect } from 'react'
import { closeAgent, getView, openDialog } from '@/shared/model'

/**
 * Глобальные горячие клавиши (вне полей ввода):
 *   N — новый агент, S — новое пространство, Esc — закрыть чат агента, / — фокус в поле ввода панели.
 */
export function useHotkeys(): void {
	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.metaKey || e.ctrlKey || e.altKey) return
			const t = e.target
			if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
			if (getView().dialog) return
			if (e.key === 'n' || e.key === 'т') {
				e.preventDefault()
				openDialog('spawn')
			} else if (e.key === 's' || e.key === 'ы') {
				e.preventDefault()
				openDialog('space')
			} else if (e.key === 'Escape' && getView().selectedAgentId) {
				closeAgent()
			} else if (e.key === '/') {
				const input = document.querySelector<HTMLTextAreaElement>('[data-composer]')
				if (input) {
					e.preventDefault()
					input.focus()
				}
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])
}
