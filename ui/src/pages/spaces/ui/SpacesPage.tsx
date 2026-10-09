/**
 * Справочник «Пространства»: путь, статус nessy serve, режим, число агентов; добавить / удалить.
 */
import { SPACE_STATUS } from '@/entities/agent'
import { copyText } from '@/shared/lib/clipboard'
import { plural } from '@/shared/lib/plural'
import { openDialog, openPage, useStore } from '@/shared/model'
import { Button, Dialog, IconButton, PathText, RefPage, StatusDot } from '@/shared/ui'
import { useRemoveSpace } from '../model/useRemoveSpace'
import s from './SpacesPage.module.css'

export function SpacesPage() {
	const spaces = useStore(st => st.spaces)
	const agents = useStore(st => st.agents)
	const r = useRemoveSpace()

	return (
		<RefPage
			title="Пространства"
			count={spaces.length}
			backLabel="К агентам"
			onBack={() => openPage({ kind: 'main' })}
			actions={
				<Button size="sm" variant="primary" icon="plus" onClick={() => openDialog('space')}>
					Добавить
				</Button>
			}
		>
			<div className={s.scroll}>
				{spaces.length === 0 ? (
					<div className={s.emptyBig}>
						<b>Пространств пока нет</b>
						<p>Пространство — рабочая папка агентов. Оркестратор поднимет для неё nessy serve.</p>
						<Button variant="primary" icon="plus" onClick={() => openDialog('space')}>
							Добавить пространство
						</Button>
					</div>
				) : (
					<div className={s.table} role="table" aria-label="Пространства">
						<div className={`${s.tr} ${s.th}`} role="row">
							<span role="columnheader">Имя</span>
							<span role="columnheader">Путь</span>
							<span role="columnheader">Статус</span>
							<span role="columnheader">Режим</span>
							<span role="columnheader">Агенты</span>
							<span role="columnheader" className="sr-only">
								Действия
							</span>
						</div>
						{spaces.map(sp => {
							const st = SPACE_STATUS[sp.status]
							const n = agents.filter(a => a.space === sp.name).length
							const working = agents.filter(a => a.space === sp.name && (a.status === 'working' || a.status === 'starting')).length
							return (
								<div key={sp.name} className={s.tr} role="row" data-space={sp.name}>
									<span className={s.spName} role="cell">
										{sp.name}
									</span>
									<span className={s.spPath} role="cell" title={sp.path}>
										<PathText path={sp.path} />
									</span>
									<span className={s.spStatus} role="cell" title={sp.error ?? undefined}>
										<StatusDot color={st.color} pulse={st.pulse} size={7} />
										{st.label}
										{sp.error && <span className={s.spErr}>{sp.error}</span>}
									</span>
									<span className={s.spMode} role="cell" title={sp.url ?? undefined}>
										{sp.mode === 'managed' ? 'свой serve' : 'внешний serve'}
									</span>
									<span className={s.spAgents} role="cell">
										{n ? plural(n, 'агент', 'агента', 'агентов') : '—'}
										{working > 0 && <span className={s.spWorking}> · {working} в работе</span>}
									</span>
									<span className={s.spActs} role="cell">
										<IconButton size="sm" icon="copy" label="Копировать путь" onClick={() => void copyText(sp.path, 'Путь скопирован')} />
										<IconButton size="sm" icon="trash" label={`Удалить ${sp.name}`} className={s.del} onClick={() => r.ask(sp)} />
									</span>
								</div>
							)
						})}
					</div>
				)}
			</div>
			{r.target && (
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
			)}
		</RefPage>
	)
}
