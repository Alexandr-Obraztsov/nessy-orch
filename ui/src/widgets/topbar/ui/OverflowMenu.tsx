/**
 * Меню «ещё» компактной панели (< 900px): счётчики, пространства, тема, версия.
 */
import { useState } from 'react'
import type { StatusResponse } from '@contract'
import { SPACE_STATUS } from '@/entities/agent'
import { useTheme, toggleTheme } from '@/shared/lib/theme'
import { openDialog, useStore } from '@/shared/model'
import { Icon, IconButton, Popover, StatusDot } from '@/shared/ui'
import type { Counters } from '../model/types'
import { CounterChips } from './CounterChips'
import { SpaceDetails } from './SpaceDetails'
import { cssVars } from '@/shared/lib/style'
import s from './OverflowMenu.module.css'

export function OverflowMenu({ counters, status }: { counters: Counters; status: StatusResponse | null }) {
	const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
	const [open, setOpen] = useState(false)
	const [expanded, setExpanded] = useState<string | null>(null)
	const spaces = useStore(x => x.spaces)
	const theme = useTheme()
	const close = (): void => setOpen(false)
	const alert = counters.permissions > 0 || spaces.some(sp => sp.status === 'failed')

	return (
		<>
			<span className={s.anchorWrap}>
				<IconButton
					icon="menu"
					label="Меню"
					aria-expanded={open}
					onClick={e => {
						setAnchor(e.currentTarget)
						setOpen(o => !o)
					}}
				/>
				{alert && <span className={s.alertDot} />}
			</span>
			<Popover open={open} anchor={anchor} onClose={close} align="end" label="Меню" className={s.menu}>
				<div className={s.section}>
					<CounterChips c={counters} vertical />
				</div>
				<div className={s.section}>
					<div className={s.heading}>
						<span>Пространства</span>
						<span className={s.count}>{spaces.length}</span>
					</div>
					{spaces.length === 0 && <p className={s.empty}>Пока нет ни одного</p>}
					{spaces.map(sp => {
						const st = SPACE_STATUS[sp.status]
						const isOpen = expanded === sp.name
						return (
							<div key={sp.name} className={s.space} style={cssVars({ '--hue': sp.color })}>
								<button type="button" className={s.item} aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : sp.name)}>
									<span className={s.hue} />
									<span className={s.label}>{sp.name}</span>
									<StatusDot color={st.color} pulse={st.pulse} size={7} title={st.label} />
									<Icon name="chevronDown" size={16} className={`${s.chev} ${isOpen ? s.chevOpen : ''}`} />
								</button>
								{isOpen && (
									<div className={s.details}>
										<SpaceDetails space={sp} bare onDone={() => setExpanded(null)} />
									</div>
								)}
							</div>
						)
					})}
					<button
						type="button"
						className={s.item}
						onClick={() => {
							close()
							openDialog('space')
						}}
					>
						<Icon name="plus" size={17} />
						<span className={s.label}>Добавить пространство</span>
					</button>
				</div>
				<div className={s.section}>
					<button type="button" className={s.item} onClick={toggleTheme}>
						<Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
						<span className={s.label}>{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>
					</button>
				</div>
				{status && (
					<div className={s.foot}>
						nessy-orch {status.version}
						{status.autoApprove && (
							<span className={s.auto}>
								<Icon name="shield" size={12} /> авто-разрешения
							</span>
						)}
					</div>
				)}
			</Popover>
		</>
	)
}
