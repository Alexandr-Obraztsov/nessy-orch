/**
 * Диалог запуска агента: роль, пространство (или произвольный путь), имя, первая задача.
 */
import type { KeyboardEvent } from 'react'
import { SPACE_STATUS } from '@/entities/agent'
import { NARROW, useMedia } from '@/shared/lib/useMedia'
import { Button, Dialog, Field, Icon, Kbd, PathText, Select, TextArea, TextInput } from '@/shared/ui'
import { OTHER_PATH } from '../lib/validate'
import { useSpawnForm } from '../model/useSpawnForm'
import { RolePicker } from './RolePicker'
import s from './SpawnAgentDialog.module.css'

const FORM_ID = 'spawn-agent-form'
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

export function SpawnAgentDialog() {
	const f = useSpawnForm()
	const touch = useMedia(NARROW)
	if (!f.open) return null

	const onKey = (e: KeyboardEvent<HTMLFormElement>): void => {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault()
			void f.submit()
		}
	}
	const selected = f.spaces.find(sp => sp.name === f.form.space)

	return (
		<Dialog
			open
			title="Новый агент"
			onClose={f.close}
			footer={
				<>
					{!touch && (
						<span className={s.kbdHint}>
							<Kbd>{MAC ? '⌘' : 'Ctrl'}</Kbd>
							<Kbd>↵</Kbd>
						</span>
					)}
					<Button variant="ghost" onClick={f.close}>
						Отмена
					</Button>
					<Button variant="primary" type="submit" form={FORM_ID} loading={f.busy} disabled={!!f.nameErr}>
						Запустить
					</Button>
				</>
			}
		>
			<form id={FORM_ID} className={s.form} onSubmit={e => void f.submit(e)} onKeyDown={onKey} noValidate>
				<fieldset className={s.fieldset}>
					<legend className={s.legend}>Роль</legend>
					<RolePicker value={f.form.role} roles={f.roles} onChange={v => f.set('role', v)} />
					{f.errors.role && <span className={s.error}>{f.errors.role}</span>}
				</fieldset>
				<div className={s.row}>
					{f.hasSpaces && (
						<Field label="Пространство" error={f.usePath ? null : f.errors.space}>
							<Select value={f.form.space} onChange={e => f.set('space', e.target.value)} aria-label="Пространство">
								{f.spaces.map(sp => (
									<option key={sp.name} value={sp.name}>
										{sp.name}
										{sp.status !== 'ready' ? ` — ${SPACE_STATUS[sp.status].label}` : ''}
									</option>
								))}
								<option value={OTHER_PATH}>Другой путь…</option>
							</Select>
						</Field>
					)}
					<Field label="Имя" error={f.errors.name ?? f.nameErr} hint={f.nameWarn ? <span className={s.warn}>{f.nameWarn}</span> : undefined}>
						<TextInput
							value={f.form.name}
							onChange={e => f.set('name', e.target.value)}
							placeholder={f.namePlaceholder}
							autoComplete="off"
							spellCheck={false}
							aria-invalid={!!(f.errors.name ?? f.nameErr)}
						/>
					</Field>
				</div>
				{!f.usePath && selected && (
					<span className={s.path}>
						<Icon name="folder" size={12} />
						<PathText path={selected.path} />
					</span>
				)}
				{f.usePath && (
					<Field
						label={f.hasSpaces ? 'Путь к рабочей папке' : 'Рабочая папка'}
						hint="Абсолютный путь. Пространство для него создастся автоматически."
						error={f.errors.space}
					>
						<TextInput
							mono
							value={f.form.path}
							onChange={e => f.set('path', e.target.value)}
							placeholder="/Users/me/projects/app"
							autoComplete="off"
							spellCheck={false}
						/>
					</Field>
				)}
				<Field label="Задача" hint="Необязательно — можно написать позже в чате">
					<TextArea
						value={f.form.prompt}
						onChange={e => f.set('prompt', e.target.value)}
						placeholder="Что сделать агенту?"
						rows={4}
						data-autofocus
					/>
				</Field>
				{f.errors.form && (
					<div className={s.banner} role="alert">
						<Icon name="alert" size={14} />
						<span>{f.errors.form}</span>
					</div>
				)}
			</form>
		</Dialog>
	)
}
