/**
 * Состояние и отправка формы запуска агента.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiFailure, api, errorText } from '@/shared/api'
import { openAgent, setView, useStore, useView } from '@/shared/model'
import { toast } from '@/shared/ui'
import { OTHER_PATH, nameError, nameWarning, pathError } from '../lib/validate'
import { takeSpawnPreset } from './preset'
import type { SpawnErrors, SpawnFormState } from './types'

const EMPTY: SpawnFormState = { space: '', path: '', name: '', prompt: '' }

/** Куда отнести ошибку сервера по её коду. */
function fieldOf(code: string): keyof SpawnErrors {
	if (code === 'name_taken') return 'name'
	if (code === 'no_space' || code === 'bad_path' || code === 'space_required') return 'space'
	return 'form'
}

export function useSpawnForm() {
	const open = useView(v => v.dialog === 'spawn')
	const spaces = useStore(s => s.spaces)
	const agents = useStore(s => s.agents)
	const [form, setForm] = useState<SpawnFormState>(EMPTY)
	const [errors, setErrors] = useState<SpawnErrors>({})
	const [busy, setBusy] = useState(false)

	// при открытии — сброс и выбор пространства по умолчанию
	useEffect(() => {
		if (!open) return
		const preset = takeSpawnPreset()
		const first = spaces.find(s => s.status === 'ready') ?? spaces[0]
		const space = preset && spaces.some(s => s.name === preset) ? preset : first ? first.name : OTHER_PATH
		setForm({ ...EMPTY, space })
		setErrors({})
		setBusy(false)
		// spaces намеренно не в зависимостях: не сбрасываем форму при обновлении статуса пространства
	}, [open])

	const usePath = form.space === OTHER_PATH || spaces.length === 0
	const nameErr = nameError(form.name, agents)
	const nameWarn = nameWarning(form.name)
	const pathErr = usePath ? pathError(form.path) : null

	const set = useCallback(<K extends keyof SpawnFormState>(key: K, value: SpawnFormState[K]): void => {
		setForm(f => ({ ...f, [key]: value }))
		setErrors(e => ({ ...e, [key === 'path' ? 'space' : key]: undefined, form: undefined }))
	}, [])

	const close = useCallback((): void => setView({ dialog: null }), [])

	const submit = async (e?: FormEvent): Promise<void> => {
		e?.preventDefault()
		if (busy) return
		if (pathErr) return setErrors({ space: pathErr })
		if (nameErr) return setErrors({ name: nameErr })
		setBusy(true)
		try {
			const res = await api.spawn({
				space: usePath ? form.path.trim() : form.space,
				name: form.name.trim() || undefined,
				prompt: form.prompt.trim() || undefined,
				from: 'you',
			})
			toast(`Агент «${res.agent.name}» запущен`, 'success')
			close()
			openAgent(res.agent.id)
		} catch (err) {
			const code = err instanceof ApiFailure ? err.code : 'unknown'
			setErrors({ [fieldOf(code)]: errorText(err) })
			setBusy(false)
		}
	}

	const spaceOptions = useMemo(() => spaces.map(s => ({ value: s.name, space: s })), [spaces])

	return { open, form, set, errors, busy, submit, close, usePath, spaceOptions, nameErr, nameWarn, hasSpaces: spaces.length > 0 }
}
