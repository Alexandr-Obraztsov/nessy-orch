import { useEffect } from 'react'
import { api, errorText } from '@/shared/api'
import { agentById, closeAgent, getView, openAgent, openDialog, openPage, setMobileTab } from '@/shared/model'
import { toast } from '@/shared/ui'

const isField = (t: EventTarget | null): boolean =>
	t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** Строки агентов в порядке на экране (видимые). */
function rows(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>('[data-row]')].filter(el => el.offsetParent !== null)
}

/** Агент, к которому относится действие с клавиатуры: строка в фокусе, иначе открытый. */
function targetAgent(): string | null {
	const el = document.activeElement
	if (el instanceof HTMLElement && el.dataset['row']) return el.dataset['row']
	return getView().selectedAgentId
}

function move(dir: 1 | -1): void {
	const list = rows()
	if (list.length === 0) return
	const cur = document.activeElement instanceof HTMLElement ? list.indexOf(document.activeElement) : -1
	let i: number
	if (cur === -1) {
		const sel = getView().selectedAgentId
		const at = sel ? list.findIndex(el => el.dataset['row'] === sel) : -1
		i = at === -1 ? (dir === 1 ? 0 : list.length - 1) : at + dir
	} else i = cur + dir
	const el = list[Math.max(0, Math.min(list.length - 1, i))]
	el?.focus()
	el?.scrollIntoView({ block: 'nearest' })
}

/**
 * Глобальные горячие клавиши (вне полей ввода и диалогов):
 *   j / k — вниз / вверх по строкам агентов; Enter — открыть (обрабатывает сама строка);
 *   a — разрешить первый запрос агента; x — прервать ход; / — поиск; n — новое поручение;
 *   Esc — закрыть детали агента.
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
			if (e.metaKey || e.ctrlKey || e.altKey || isField(e.target)) return
			// раскладка не важна: e.code — физическая клавиша
			switch (e.code) {
				case 'KeyN':
					e.preventDefault()
					openDialog('spawn')
					return
				case 'Slash': {
					const input = document.querySelector<HTMLInputElement>('[data-search]')
					if (input) {
						e.preventDefault()
						if (v.page.kind === 'main') setMobileTab('tasks')
						input.focus()
						input.select()
					}
					return
				}
			}
			if (v.page.kind !== 'main') return
			switch (e.code) {
				case 'KeyJ':
					e.preventDefault()
					move(1)
					return
				case 'KeyK':
					e.preventDefault()
					move(-1)
					return
				case 'KeyO': {
					const id = targetAgent()
					if (id) openAgent(id)
					return
				}
				case 'KeyA': {
					const id = targetAgent()
					const a = id ? agentById(id) : undefined
					const req = a?.pendingPermissions[0]
					if (!a || !req) return
					e.preventDefault()
					api.permission(a.id, req.requestId, true).catch((err: unknown) => toast(`Не удалось разрешить: ${errorText(err)}`, 'error'))
					return
				}
				case 'KeyX': {
					const id = targetAgent()
					const a = id ? agentById(id) : undefined
					if (!a || (a.status !== 'working' && a.status !== 'starting')) return
					e.preventDefault()
					api.cancel(a.id).catch((err: unknown) => toast(`Не удалось прервать: ${errorText(err)}`, 'error'))
					return
				}
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])
}
