/**
 * Состояние и отправка формы добавления пространства.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiFailure, api, errorText } from '@/shared/api'
import { setView, useStore, useView } from '@/shared/model'
import { toast } from '@/shared/ui'
import { baseName, pathError, urlError } from '../lib/validate'
import type { SpaceErrors, SpaceField, SpaceFormState } from './types'

const EMPTY: SpaceFormState = { path: '', name: '', external: false, url: '' }

function fieldOf(code: string): SpaceField {
	if (code === 'bad_path') return 'path'
	if (code === 'space_exists') return 'name'
	return 'form'
}

export function useSpaceForm() {
	const open = useView(v => v.dialog === 'space')
	const spaces = useStore(s => s.spaces)
	const [form, setForm] = useState<SpaceFormState>(EMPTY)
	const [errors, setErrors] = useState<SpaceErrors>({})
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		if (!open) return
		setForm(EMPTY)
		setErrors({})
		setBusy(false)
	}, [open])

	const set = useCallback(<K extends keyof SpaceFormState>(key: K, value: SpaceFormState[K]): void => {
		setForm(f => ({ ...f, [key]: value }))
		setErrors(e => ({ ...e, [key === 'external' ? 'url' : key]: undefined, form: undefined }))
	}, [])

	const close = useCallback((): void => setView({ dialog: null }), [])

	// имя по умолчанию и предупреждение о дубле пути
	const defaultName = baseName(form.path)
	const samePath = spaces.find(s => s.path === form.path.trim().replace(/\/+$/, ''))

	const submit = async (e?: FormEvent): Promise<void> => {
		e?.preventDefault()
		if (busy) return
		const next: SpaceErrors = {}
		const pe = pathError(form.path)
		if (pe) next.path = pe
		if (form.external) {
			const ue = urlError(form.url)
			if (ue) next.url = ue
		}
		if (next.path || next.url) return setErrors(next)
		setBusy(true)
		try {
			const sp = await api.addSpace({
				path: form.path.trim(),
				name: form.name.trim() || undefined,
				url: form.external ? form.url.trim() : undefined,
			})
			toast(samePath ? `Пространство «${sp.name}» уже было добавлено` : `Пространство «${sp.name}» добавлено`, 'success')
			close()
		} catch (err) {
			const code = err instanceof ApiFailure ? err.code : 'unknown'
			setErrors({ [fieldOf(code)]: errorText(err) })
			setBusy(false)
		}
	}

	return { open, form, set, errors, busy, submit, close, defaultName, samePath }
}
