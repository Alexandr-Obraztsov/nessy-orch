/**
 * Верхняя панель: бренд, связь, живые счётчики, пространства, действия, тема.
 * < 900px — компактно: бренд, точка связи, «+ Агент» и меню «ещё».
 */
import { toggleTheme, useTheme } from '@/shared/lib/theme'
import { NARROW, useMedia } from '@/shared/lib/useMedia'
import { openDialog } from '@/shared/model'
import { Button, Icon, IconButton, Kbd } from '@/shared/ui'
import { useCounters } from '../model/useCounters'
import { useOrchStatus } from '../model/useOrchStatus'
import { BrandMark } from './BrandMark'
import { ConnPill } from './ConnPill'
import { CounterChips } from './CounterChips'
import { OverflowMenu } from './OverflowMenu'
import { SpaceStrip } from './SpaceStrip'
import s from './TopBar.module.css'

export interface TopBarProps {
	/** кнопка выдвижного ростера (средняя ширина, когда ростер не помещается колонкой) */
	roster?: { open: boolean; toggle: () => void } | null
}

function uptime(sec: number): string {
	const h = Math.floor(sec / 3600)
	const m = Math.floor((sec % 3600) / 60)
	return h ? `${h} ч ${m} мин` : `${m} мин`
}

export function TopBar({ roster }: TopBarProps) {
	const compact = useMedia(NARROW)
	const theme = useTheme()
	const counters = useCounters()
	const status = useOrchStatus()

	const brandTitle = status
		? `nessy-orch ${status.version} · pid ${status.pid} · работает ${uptime(status.uptimeSec)}\n${status.home}`
		: 'nessy-orch'

	return (
		<header className={s.bar}>
			{roster && (
				<IconButton
					icon="users"
					label={roster.open ? 'Скрыть список агентов' : 'Показать список агентов'}
					aria-pressed={roster.open}
					className={roster.open ? s.toggled : undefined}
					onClick={roster.toggle}
				/>
			)}
			<div className={s.brand} title={brandTitle}>
				<BrandMark size={compact ? 26 : 28} />
				<span className={s.word}>
					nessy<span className={s.sep}>·</span>
					<span className={s.orch}>orch</span>
				</span>
			</div>

			<ConnPill compact={compact} />

			{!compact && (
				<>
					{status?.autoApprove && (
						<span className={s.auto} title="Авто-разрешения включены: инструменты агентов выполняются без подтверждения">
							<Icon name="shield" size={13} />
							<span className={s.autoLabel}>авто</span>
						</span>
					)}
					<span className={s.divider} />
					<CounterChips c={counters} />
					<span className={s.divider} />
					<SpaceStrip />
					<Button
						variant="ghost"
						icon="layers"
						onClick={() => openDialog('space')}
						title="Добавить пространство (S)"
						className={s.addSpace}
					>
						<span className={s.addSpaceLabel}>Пространство</span>
					</Button>
					<Button variant="primary" icon="plus" onClick={() => openDialog('spawn')} title="Запустить агента (N)">
						Агент
						<span className={s.kbd}>
							<Kbd>N</Kbd>
						</span>
					</Button>
					<IconButton
						icon={theme === 'dark' ? 'sun' : 'moon'}
						label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
						onClick={toggleTheme}
					/>
				</>
			)}

			{compact && (
				<>
					<span className={s.grow} />
					{counters.working > 0 && (
						<span className={`${s.counter} ${s.cWorking} ${s.on}`} title="Работают">
							<span className={s.cDot} />
							<b>{counters.working}</b>
						</span>
					)}
					<IconButton variant="primary" icon="plus" label="Новый агент" onClick={() => openDialog('spawn')} />
					<OverflowMenu counters={counters} status={status} />
				</>
			)}
		</header>
	)
}
