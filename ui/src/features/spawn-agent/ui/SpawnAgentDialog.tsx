/**
 * Диалог запуска агента: пространство (или произвольный путь), имя, первая задача.
 */
import type { KeyboardEvent } from 'react'
import { NARROW, useMedia } from '@/shared/lib/useMedia'
import { Button, Dialog, Field, Icon, Kbd, PathText, TextArea, TextInput } from '@/shared/ui'
import { useSpawnForm } from '../model/useSpawnForm'
import { SpacePicker } from './SpacePicker'
import s from './SpawnAgentDialog.module.css'

const FORM_ID = 'spawn-agent-form'
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

export function SpawnAgentDialog() {
	const f = useSpawnForm()
	const touch = useMedia(NARROW)
	if (!f.open) return null

	const onPromptKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void f.submit()
	}
	const selected = f.spaceOptions.find(o => o.value === f.form.space)?.space

	return (
		<Dialog
			open
			title="Новый агент"
			subtitle="Сессия nessy в пространстве. Задачу можно дать сразу или позже в чате."
			onClose={f.close}
			footer={
				<>
					<Button variant="ghost" onClick={f.close}>
						Отмена
					</Button>
					<Button variant="primary" icon="bolt" type="submit" form={FORM_ID} loading={f.busy} disabled={!!f.nameErr}>
						Запустить
					</Button>
				</>
			}
		>
			<form id={FORM_ID} className={s.form} onSubmit={e => void f.submit(e)} noValidate>
				{f.hasSpaces && (
					<fieldset className={s.fieldset}>
						<legend className={s.legend}>Пространство</legend>
						<SpacePicker value={f.form.space} options={f.spaceOptions} onChange={v => f.set('space', v)} />
						{!f.usePath && selected && (
							<span className={s.path}>
								<Icon name="folder" size={13} />
								<PathText path={selected.path} />
							</span>
						)}
						{!f.usePath && f.errors.space && <span className={s.error}>{f.errors.space}</span>}
					</fieldset>
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
							autoFocus={f.hasSpaces}
						/>
					</Field>
				)}
				<Field
					label="Имя"
					error={f.errors.name ?? f.nameErr}
					hint={
						f.nameWarn ? (
							<span className={s.warn}>{f.nameWarn}</span>
						) : (
							'Необязательно. Уникальное — по нему к агенту обращаются вы и другие агенты.'
						)
					}
				>
					<TextInput
						value={f.form.name}
						onChange={e => f.set('name', e.target.value)}
						placeholder="например, reviewer"
						autoComplete="off"
						spellCheck={false}
						aria-invalid={!!(f.errors.name ?? f.nameErr)}
					/>
				</Field>
				<Field
					label="Задача"
					hint={
						touch ? (
							'Необязательно — можно написать позже в чате'
						) : (
							<span className={s.kbdHint}>
								Необязательно. <Kbd>{MAC ? '⌘' : 'Ctrl'}</Kbd>
								<Kbd>↵</Kbd> — запустить
							</span>
						)
					}
				>
					<TextArea
						value={f.form.prompt}
						onChange={e => f.set('prompt', e.target.value)}
						onKeyDown={onPromptKey}
						placeholder="Что сделать агенту? Например: «проверь README и предложи правки»"
						rows={5}
					/>
				</Field>
				{f.errors.form && (
					<div className={s.banner} role="alert">
						<Icon name="alert" size={16} />
						<span>{f.errors.form}</span>
					</div>
				)}
			</form>
		</Dialog>
	)
}
