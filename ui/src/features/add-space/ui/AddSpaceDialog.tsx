/**
 * Диалог добавления пространства: рабочая папка + (необязательно) внешний nessy serve.
 */
import { Button, Dialog, Field, Icon, Switch, TextInput } from '@/shared/ui'
import { useSpaceForm } from '../model/useSpaceForm'
import s from './AddSpaceDialog.module.css'

const FORM_ID = 'add-space-form'

export function AddSpaceDialog() {
	const f = useSpaceForm()
	if (!f.open) return null

	return (
		<Dialog
			open
			title="Новое пространство"
			subtitle="Рабочая папка агентов. Оркестратор поднимет для неё nessy serve."
			onClose={f.close}
			footer={
				<>
					<Button variant="ghost" onClick={f.close}>
						Отмена
					</Button>
					<Button variant="primary" type="submit" form={FORM_ID} loading={f.busy}>
						Добавить
					</Button>
				</>
			}
		>
			<form id={FORM_ID} className={s.form} onSubmit={e => void f.submit(e)} noValidate>
				<Field
					label="Путь к папке"
					error={f.errors.path}
					hint={
						f.samePath ? (
							<span className={s.note}>Уже добавлено как «{f.samePath.name}» — повторно не создастся</span>
						) : (
							'Абсолютный путь к воркспейсу'
						)
					}
				>
					<TextInput
						mono
						value={f.form.path}
						onChange={e => f.set('path', e.target.value)}
						placeholder="/Users/me/projects/app"
						autoComplete="off"
						spellCheck={false}
						aria-invalid={!!f.errors.path}
					/>
				</Field>
				<Field label="Имя" error={f.errors.name} hint="Необязательно. По умолчанию — имя папки.">
					<TextInput
						value={f.form.name}
						onChange={e => f.set('name', e.target.value)}
						placeholder={f.defaultName || 'например, shippy'}
						autoComplete="off"
						spellCheck={false}
					/>
				</Field>
				<div className={s.external}>
					<Switch
						checked={f.form.external}
						onChange={v => f.set('external', v)}
						label="Внешний nessy serve"
						hint="Подключиться к уже запущенному серверу вместо запуска своего"
					/>
					{f.form.external && (
						<div className={s.reveal}>
							<Field label="Адрес сервера" error={f.errors.url}>
								<TextInput
									mono
									value={f.form.url}
									onChange={e => f.set('url', e.target.value)}
									placeholder="http://127.0.0.1:4096"
									inputMode="url"
									autoComplete="off"
									spellCheck={false}
									autoFocus
								/>
							</Field>
						</div>
					)}
				</div>
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
