/**
 * Состояние и отправка формы «Новое поручение»: задача, роль, пространство, имя агента.
 * После запуска открываются детали нового агента.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiFailure, api, errorText } from '@/shared/api'
import { getView, openAgent, setView, useStore, useView } from '@/shared/model'
import { OTHER_PATH, nameError, nameWarning, pathError, suggestName } from '../lib/validate'
import type { SpawnErrors, SpawnFormState } from './types'

const EMPTY: SpawnFormState = { space: '', path: '', name: '', role: '', prompt: '' }

/** Куда отнести ошибку сервера по её коду. */
function fieldOf(code: string): keyof SpawnErrors {
	if (code === 'name_taken' || code === 'bad_name') return 'name'
	if (code === 'no_space' || code === 'bad_path' || code === 'space_required') return 'space'
	if (code.includes('role')) return 'role'
	return 'form'
}

export function useSpawnForm() {
	const open = useView(v => v.dialog === 'spawn')
	const spaces = useStore(s => s.spaces)
	const agents = useStore(s => s.agents)
	const roles = useStore(s => s.roles)
	const [form, setForm] = useState<SpawnFormState>(EMPTY)
	const [errors, setErrors] = useState<SpawnErrors>({})
	const [busy, setBusy] = useState(false)

	// при открытии — сброс и предвыбор (пространство/роль из spawnPreset)
	useEffect(() => {
		if (!open) return
		const preset = getView().spawnPreset
		const first = spaces.find(s => s.status === 'ready') ?? spaces[0]
		const space = preset?.space && spaces.some(s => s.name === preset.space) ? preset.space : first ? first.name : OTHER_PATH
		const role = preset?.role ? (roles.find(r => r.id === preset.role || r.name === preset.role)?.id ?? '') : ''
		setForm({ ...EMPTY, space, role })
		setErrors({})
		setBusy(false)
		// spaces/roles намеренно не в зависимостях: не сбрасываем форму при обновлении статусов
	}, [open])

	const usePath = form.space === OTHER_PATH || spaces.length === 0
	const nameErr = nameError(form.name, agents)
	const nameWarn = nameWarning(form.name)
	const pathErr = usePath ? pathError(form.path) : null
	const role = roles.find(r => r.id === form.role) ?? null
	const namePlaceholder = role ? suggestName(role.name, agents) : 'например, reviewer'

	const set = useCallback(<K extends keyof SpawnFormState>(key: K, value: SpawnFormState[K]): void => {
		setForm(f => ({ ...f, [key]: value }))
		setErrors(e => ({ ...e, [key === 'path' ? 'space' : key]: undefined, form: undefined }))
	}, [])

	const close = useCallback((): void => setView({ dialog: null, spawnPreset: null }), [])

	const submit = async (e?: FormEvent): Promise<void> => {
		e?.preventDefault()
		if (busy) return
		if (!form.prompt.trim()) return setErrors({ prompt: 'Опишите, что нужно сделать' })
		if (pathErr) return setErrors({ space: pathErr })
		if (nameErr) return setErrors({ name: nameErr })
		setBusy(true)
		try {
			const res = await api.spawn({
				space: usePath ? form.path.trim() : form.space,
				name: form.name.trim() || undefined,
				role: form.role || undefined,
				prompt: form.prompt.trim() || undefined,
				from: 'you',
			})
			close()
			openAgent(res.agent.id)
		} catch (err) {
			const code = err instanceof ApiFailure ? err.code : 'unknown'
			setErrors({ [fieldOf(code)]: errorText(err) })
			setBusy(false)
		}
	}

	return { open, form, set, errors, busy, submit, close, usePath, spaces, roles, role, nameErr, nameWarn, namePlaceholder, hasSpaces: spaces.length > 0 }
}
