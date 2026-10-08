import { Button, Dialog } from '@/shared/ui'
import type { useRemoveRole, useRemoveSpace } from '../model/useRemove'
import s from './Sidebar.module.css'

export function RemoveSpaceDialog({ r }: { r: ReturnType<typeof useRemoveSpace> }) {
	if (!r.target) return null
	return (
		<Dialog
			open
			title={`Удалить пространство «${r.target.name}»?`}
			subtitle={r.target.path}
			onClose={r.cancel}
			footer={
				<>
					<Button variant="ghost" onClick={r.cancel}>
						Отмена
					</Button>
					<Button variant="danger" icon="trash" loading={r.busy} onClick={() => void r.run()} data-autofocus>
						{r.force ? 'Удалить вместе с агентами' : 'Удалить'}
					</Button>
				</>
			}
		>
			<p className={s.dlgText}>
				{r.force
					? 'В пространстве есть агенты — они будут остановлены и удалены.'
					: 'Папка на диске не изменится; оркестратор остановит свой nessy serve.'}
			</p>
			{r.error && <p className={s.dlgError}>{r.error}</p>}
		</Dialog>
	)
}

export function RemoveRoleDialog({ r, users }: { r: ReturnType<typeof useRemoveRole>; users: number }) {
	if (!r.target) return null
	return (
		<Dialog
			open
			title={`Удалить роль «${r.target.name}»?`}
			onClose={r.cancel}
			footer={
				<>
					<Button variant="ghost" onClick={r.cancel}>
						Отмена
					</Button>
					<Button variant="danger" icon="trash" loading={r.busy} onClick={() => void r.run()} data-autofocus>
						Удалить
					</Button>
				</>
			}
		>
			<p className={s.dlgText}>
				{users ? `Её используют агентов: ${users} — они продолжат работать с прежними инструкциями. ` : ''}
				Роль исчезнет из списка и из диалога запуска.
			</p>
		</Dialog>
	)
}
