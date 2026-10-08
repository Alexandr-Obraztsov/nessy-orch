/**
 * Карточка пространства: статус, путь (копирование), адрес nessy serve, ошибка, удаление.
 */
import type { SpaceView } from '@contract'
import { SPACE_STATUS } from '@/entities/agent'
import { useStore } from '@/shared/model'
import { Button, IconButton, PathText, StatusDot } from '@/shared/ui'
import { copyText } from '../lib/clipboard'
import { useRemoveSpace } from '../model/useRemoveSpace'
import { cssVars } from '@/shared/lib/style'
import s from './SpaceDetails.module.css'

export interface SpaceDetailsProps {
	space: SpaceView
	onDone: () => void
	/** скрыть заголовок (если он уже есть снаружи, например в меню) */
	bare?: boolean
}

export function SpaceDetails({ space, onDone, bare }: SpaceDetailsProps) {
	const st = SPACE_STATUS[space.status]
	const inside = useStore(x => x.agents.filter(a => a.space === space.name).length)
	const rm = useRemoveSpace(space.name, onDone)

	return (
		<div className={s.card} style={cssVars({ '--hue': space.color })}>
			{!bare && (
				<div className={s.head}>
					<span className={s.hue} />
					<span className={s.name}>{space.name}</span>
					<span className={s.mode}>{space.mode === 'managed' ? 'свой serve' : 'внешний'}</span>
				</div>
			)}
			<dl className={s.list}>
				<dt>Статус</dt>
				<dd className={s.status}>
					<StatusDot color={st.color} pulse={st.pulse} size={7} />
					{st.label}
					<span className={s.muted}>· агентов: {inside}</span>
				</dd>
				<dt>Путь</dt>
				<dd className={s.copyRow}>
					<PathText path={space.path} className={s.mono} />
					<IconButton icon="copy" size="sm" label="Скопировать путь" onClick={() => void copyText(space.path, 'Путь скопирован')} />
				</dd>
				{space.url && (
					<>
						<dt>Сервер</dt>
						<dd className={s.copyRow}>
							<span className={`${s.mono} ${s.ellipsis}`} title={space.url}>
								{space.url}
							</span>
							<IconButton
								icon="copy"
								size="sm"
								label="Скопировать адрес"
								onClick={() => void copyText(space.url ?? '', 'Адрес скопирован')}
							/>
						</dd>
					</>
				)}
			</dl>
			{space.error && <p className={s.error}>{space.error}</p>}
			<div className={s.danger}>
				{rm.stage === 'idle' && (
					<Button size="sm" variant="ghost" icon="trash" className={s.rmBtn} onClick={rm.ask}>
						Удалить пространство
					</Button>
				)}
				{(rm.stage === 'confirm' || rm.stage === 'busy') && (
					<div className={s.confirm}>
						<p>
							Остановить nessy serve и убрать «{space.name}»?
							{inside > 0 && ` В нём ${inside} агент(ов).`}
						</p>
						<div className={s.actions}>
							<Button size="sm" variant="ghost" onClick={rm.cancel}>
								Отмена
							</Button>
							<Button size="sm" variant="danger" loading={rm.stage === 'busy'} onClick={rm.confirm}>
								Удалить
							</Button>
						</div>
					</div>
				)}
				{(rm.stage === 'force' || rm.stage === 'forceBusy') && (
					<div className={s.confirm}>
						<p>{rm.error ?? 'В пространстве есть агенты.'}</p>
						<div className={s.actions}>
							<Button size="sm" variant="ghost" onClick={rm.cancel}>
								Отмена
							</Button>
							<Button size="sm" variant="danger" loading={rm.stage === 'forceBusy'} onClick={rm.force}>
								Удалить вместе с агентами
							</Button>
						</div>
					</div>
				)}
				{rm.error && rm.stage === 'confirm' && <p className={s.error}>{rm.error}</p>}
			</div>
		</div>
	)
}
