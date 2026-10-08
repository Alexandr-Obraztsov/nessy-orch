/**
 * Редактор роли: черновик (переживает переключение ролей), сохранение (Ctrl/Cmd+S), удаление.
 * Новая роль после создания открывается по своему настоящему id.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RoleView } from '@contract'
import { hueFromName } from '@/entities/role'
import { ApiFailure, api, errorText } from '@/shared/api'
import { getState, openRole, useStore } from '@/shared/model'
import { toast } from '@/shared/ui'
import { roleFieldOf, validateRole } from '../lib/errors'
import { getDraft, putDraft } from './drafts'
import type { RoleDraft, RoleErrors } from './types'

const fromRole = (r: RoleView | undefined): RoleDraft =>
	r
		? { name: r.name, description: r.description, instructions: r.instructions, color: r.color }
		: { name: '', description: '', instructions: '', color: -1 }

const same = (a: RoleDraft, b: RoleDraft): boolean =>
	a.name === b.name && a.description === b.description && a.instructions === b.instructions && a.color === b.color

/** Открыть первую роль, кроме данной (или форму новой, если ролей нет). */
export function openOtherRole(id: string | null): void {
	openRole(getState().roles.find(r => r.id !== id)?.id ?? null)
}

export function useRoleEditor(id: string | null) {
	const role = useStore(s => (id ? s.roles.find(r => r.id === id) : undefined))
	const agents = useStore(s => s.agents)
	const conn = useStore(s => s.conn)
	const base = useMemo(() => fromRole(role), [role])
	const [draft, setDraft] = useState<RoleDraft>(() => getDraft(id) ?? base)
	const [errors, setErrors] = useState<RoleErrors>({})
	const [busy, setBusy] = useState(false)
	const [confirmDelete, setConfirmDelete] = useState(false)

	// роль пришла позже (снапшот) — подхватываем, если правок ещё нет
	const touched = useRef(Boolean(getDraft(id)))
	useEffect(() => {
		if (!touched.current) setDraft(base)
	}, [base])

	const dirty = !same(draft, base)
	useEffect(() => {
		putDraft(id, dirty ? draft : null)
	}, [id, draft, dirty])

	const set = useCallback(<K extends keyof RoleDraft>(key: K, value: RoleDraft[K]): void => {
		touched.current = true
		setDraft(d => ({ ...d, [key]: value }))
		setErrors(e => ({ ...e, [key]: undefined, form: undefined }))
	}, [])

	// цвет по умолчанию — из имени (пока не выбран вручную)
	const color = draft.color >= 0 ? draft.color : hueFromName(draft.name || 'role')

	const save = useCallback(async (): Promise<void> => {
		if (busy) return
		const local = validateRole(draft.name, draft.instructions)
		if (local.name || local.instructions) {
			setErrors(local)
			return
		}
		setBusy(true)
		const req = { name: draft.name.trim(), description: draft.description.trim(), instructions: draft.instructions, color }
		try {
			if (id) {
				await api.updateRole(id, req)
				putDraft(id, null)
				touched.current = false
				toast(`Роль «${req.name}» сохранена`, 'success', 2000)
			} else {
				const created = await api.createRole(req)
				putDraft(null, null)
				toast(`Роль «${created.name}» создана`, 'success', 2000)
				openRole(created.id)
			}
			setErrors({})
		} catch (e) {
			const code = e instanceof ApiFailure ? e.code : 'unknown'
			const text = errorText(e)
			setErrors({ [roleFieldOf(code, text)]: text })
		} finally {
			setBusy(false)
		}
	}, [busy, draft, color, id])

	const remove = useCallback(async (): Promise<void> => {
		if (!id) {
			putDraft(null, null)
			openOtherRole(null)
			return
		}
		setBusy(true)
		try {
			await api.removeRole(id)
			putDraft(id, null)
			toast(`Роль «${role?.name ?? id}» удалена`, 'success')
			openOtherRole(id)
		} catch (e) {
			toast(`Не удалось удалить роль: ${errorText(e)}`, 'error')
			setBusy(false)
			setConfirmDelete(false)
		}
	}, [id, role])

	const users = useMemo(() => (id ? agents.filter(a => a.role === id) : []), [agents, id])

	return {
		role,
		/** вкладка открыта на роль, которой больше нет */
		missing: Boolean(id) && !role && conn === 'live',
		draft,
		color,
		set,
		dirty: id ? dirty : true,
		errors,
		busy,
		save,
		remove,
		confirmDelete,
		setConfirmDelete,
		users,
	}
}
