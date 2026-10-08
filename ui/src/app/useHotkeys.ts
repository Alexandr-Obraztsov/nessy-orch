import { useEffect } from 'react'
import { activeTab, closeTab, getView, openDialog, openFeed, openGraph, openRole, setView, toggleSidebar } from '@/shared/model'

const isField = (t: EventTarget | null): boolean =>
	t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/**
 * Глобальные горячие клавиши:
 *   N — новый агент, R — новая роль, G — граф, F — лента, / — фокус в поле ввода (вне полей ввода);
 *   Ctrl/Cmd+W — закрыть вкладку; Esc — закрыть выезжающую панель (диалоги закрываются сами).
 */
export function useHotkeys(): void {
	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.defaultPrevented) return
			const v = getView()
			// Ctrl/Cmd+W — работает и из поля ввода (браузер иначе закроет вкладку целиком)
			if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyW' || e.key === 'w')) {
				if (v.dialog) return
				const t = activeTab(v)
				if (t.kind === 'feed') return
				e.preventDefault()
				closeTab(v.active)
				return
			}
			if (e.key === 'Escape') {
				if (v.sidebarOpen && !v.dialog) {
					e.preventDefault()
					toggleSidebar(false)
				}
				return
			}
			if (e.metaKey || e.ctrlKey || e.altKey || isField(e.target) || v.dialog) return
			// раскладка не важна: e.code — физическая клавиша
			switch (e.code) {
				case 'KeyN':
					e.preventDefault()
					openDialog('spawn')
					return
				case 'KeyR':
					e.preventDefault()
					openRole(null)
					return
				case 'KeyG':
					e.preventDefault()
					openGraph()
					return
				case 'KeyF':
					e.preventDefault()
					openFeed()
					return
				case 'Slash': {
					const input = document.querySelector<HTMLTextAreaElement>('[data-composer]')
					if (input) {
						e.preventDefault()
						input.focus()
					}
					return
				}
			}
			// переключение вкладок: Ctrl+Tab браузер не отдаёт — [ и ]
			if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
				const n = v.tabs.length
				setView({ active: (v.active + (e.code === 'BracketRight' ? 1 : -1) + n) % n })
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
