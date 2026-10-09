import { useEffect } from 'react'
import { closeAgent, getView, openAgent, openPage } from '@/shared/model'

const isField = (t: EventTarget | null): boolean =>
	t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** Строки агентов в порядке на экране (без свёрнутых и скрытых групп). */
function rows(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>('[data-row]')].filter(el => !el.closest('[data-hidden]'))
}

/** Перейти к соседней строке; если детали открыты — сразу показать их для новой строки. */
function move(dir: 1 | -1): void {
	const list = rows()
	if (list.length === 0) return
	const active = document.activeElement
	let cur = active instanceof HTMLElement ? list.indexOf(active) : -1
	if (cur === -1) {
		const sel = getView().selectedAgentId
		cur = sel ? list.findIndex(el => el.dataset['row'] === sel) : -1
	}
	const i = cur === -1 ? (dir === 1 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, cur + dir))
	const el = list[i]
	if (!el) return
	el.focus({ preventScroll: true })
	el.scrollIntoView({ block: 'nearest' })
	const id = el.dataset['row']
	if (id && getView().selectedAgentId) openAgent(id)
}

/**
 * Глобальные горячие клавиши (вне полей ввода и диалогов):
 *   j / k (и стрелки вне кнопок) — вниз / вверх по строкам; Enter — открыть детали (обрабатывает строка);
 *   Esc — закрыть детали (на справочниках — вернуться к таблице).
 */
export function useHotkeys(): void {
	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.defaultPrevented) return
			const v = getView()
			if (v.dialog) return
			if (e.key === 'Escape') {
				if (isField(e.target)) return
				if (v.selectedAgentId) {
					e.preventDefault()
					closeAgent()
				} else if (v.page.kind !== 'main') openPage({ kind: 'main' })
				return
			}
			if (e.metaKey || e.ctrlKey || e.altKey || isField(e.target) || v.page.kind !== 'main') return
			const onControl = e.target instanceof HTMLElement && e.target.closest('button, a, summary') !== null
			// раскладка не важна: e.code — физическая клавиша
			if (e.code === 'KeyJ' || (e.key === 'ArrowDown' && !onControl)) {
				e.preventDefault()
				move(1)
			} else if (e.code === 'KeyK' || (e.key === 'ArrowUp' && !onControl)) {
				e.preventDefault()
				move(-1)
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])
}
