/**
 * Состояние навигации UI: страница, открытые колонки-задачи, окно агента, сайдбар.
 * Отдельно от данных сервера (store.ts). Колонки и окно отражаются в URL без перезагрузки:
 *   ?task=<id>            — одна задача;   ?task=a,b — несколько рядом;   без task — «Все агенты»;
 *   ?task=@none           — агенты без задачи;   &agent=<id> — открытое окно агента;
 *   ?page=roles[&role=id] / ?page=spaces — справочники.
 * Кнопки «назад/вперёд» браузера возвращают прежний вид (popstate).
 */
import { useSyncExternalStore } from 'react'
import { readStorage, writeStorage } from '@/shared/lib/storage'
import type { ColumnId, DialogKind, Page, ViewState } from './view.types'

export const ALL_AGENTS = '@all'
export const NO_TASK = '@none'
const MAX_COLUMNS = 3
const KEY = 'nessy-orch:view-v5'

function restoreSidebar(): boolean {
	return readStorage(KEY) !== 'collapsed'
}

/** Вид из адресной строки. */
function fromUrl(): Pick<ViewState, 'page' | 'columns' | 'agentId'> {
	const q = new URLSearchParams(window.location.search)
	const p = q.get('page')
	const page: Page = p === 'roles' ? { kind: 'roles', roleId: q.get('role') } : p === 'spaces' ? { kind: 'spaces' } : { kind: 'main' }
	const ids = (q.get('task') ?? '')
		.split(',')
		.map(x => x.trim())
		.filter(Boolean)
	const columns = [...new Set(ids)].slice(0, MAX_COLUMNS)
	return { page, columns: columns.length > 0 ? columns : [ALL_AGENTS], agentId: q.get('agent') || null }
}

function toUrl(v: ViewState): string {
	const q = new URLSearchParams()
	if (v.page.kind === 'roles') {
		q.set('page', 'roles')
		if (v.page.roleId) q.set('role', v.page.roleId)
	} else if (v.page.kind === 'spaces') q.set('page', 'spaces')
	else {
		const cols = v.columns.filter(c => c !== ALL_AGENTS || v.columns.length > 1)
		if (cols.length > 0) q.set('task', cols.join(','))
		if (v.agentId) q.set('agent', v.agentId)
	}
	// запятые в списке задач оставляем читаемыми
	const s = q.toString().replace(/%2C/gi, ',').replace(/%40/g, '@')
	return `${window.location.pathname}${s ? `?${s}` : ''}${window.location.hash}`
}

let view: ViewState = {
	...fromUrl(),
	sidebar: restoreSidebar(),
	drawer: false,
	dialog: null,
}
const listeners = new Set<() => void>()

function emit(): void {
	for (const fn of listeners) fn()
}

/**
 * Применить изменение вида. history: push — новая запись истории (навигация), replace — поправить текущую,
 * none — не трогать адрес (локальные настройки).
 */
function update(patch: Partial<ViewState>, history: 'push' | 'replace' | 'none' = 'none'): void {
	view = { ...view, ...patch }
	if (history !== 'none') {
		const url = toUrl(view)
		const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`
		if (url !== cur) {
			if (history === 'push') window.history.pushState(null, '', url)
			else window.history.replaceState(null, '', url)
		}
	}
	emit()
}

if (typeof window !== 'undefined')
	window.addEventListener('popstate', () => {
		view = { ...view, ...fromUrl(), drawer: false }
		emit()
	})

export function getView(): ViewState {
	return view
}

export function useView<T>(selector: (v: ViewState) => T): T {
	return useSyncExternalStore(
		fn => {
			listeners.add(fn)
			return () => {
				listeners.delete(fn)
			}
		},
		() => selector(view),
	)
}

/** Открыть одну колонку (задачу, «Все агенты» или «Без задачи»). */
export function openColumn(id: ColumnId): void {
	update({ page: { kind: 'main' }, columns: [id], agentId: null, drawer: false }, 'push')
}

/** «Открыть рядом»: добавить колонку справа (не больше трёх) или убрать, если уже открыта. */
export function toggleColumnBeside(id: ColumnId): void {
	const has = view.columns.includes(id)
	let columns: ColumnId[]
	if (view.page.kind !== 'main') columns = [id]
	else if (has) columns = view.columns.length > 1 ? view.columns.filter(c => c !== id) : view.columns
	else columns = [...view.columns, id].slice(-MAX_COLUMNS)
	update({ page: { kind: 'main' }, columns, drawer: false }, 'push')
}

export function closeColumn(id: ColumnId): void {
	const columns = view.columns.filter(c => c !== id)
	update({ columns: columns.length > 0 ? columns : [ALL_AGENTS] }, 'push')
}

/** Окно агента. */
export function openAgent(id: string): void {
	if (view.agentId === id) return
	// окно поверх окна не открываем: смена агента внутри окна заменяет запись истории
	update({ page: { kind: 'main' }, agentId: id }, view.agentId ? 'replace' : 'push')
}

export function closeAgent(): void {
	if (view.agentId) update({ agentId: null }, 'push')
}

export function openPage(page: Page): void {
	update({ page, agentId: null, drawer: false }, 'push')
}

export const openRole = (roleId: string | null): void => {
	update({ page: { kind: 'roles', roleId }, agentId: null, drawer: false }, view.page.kind === 'roles' ? 'replace' : 'push')
}

export function openDialog(dialog: DialogKind): void {
	update({ dialog })
}

export function setSidebar(open: boolean): void {
	writeStorage(KEY, open ? 'open' : 'collapsed')
	update({ sidebar: open })
}

export function setDrawer(open: boolean): void {
	update({ drawer: open })
}

/** Произвольная правка вида без изменения адреса (диалоги). */
export function setView(patch: Partial<ViewState>): void {
	update(patch)
}
