import { reconnectNow, useStore } from '@/shared/model'
import { Button, StatusDot } from '@/shared/ui'
import s from './TopBar.module.css'

const META = {
	live: { label: 'в сети', color: 'var(--st-idle)', pulse: false },
	connecting: { label: 'подключение…', color: 'var(--st-starting)', pulse: true },
	offline: { label: 'нет связи', color: 'var(--st-error)', pulse: false },
} as const

/** Состояние потока /stream. `compact` — только точка (кнопка переподключения остаётся). */
export function ConnPill({ compact }: { compact?: boolean }) {
	const conn = useStore(st => st.conn)
	const m = META[conn]
	const title =
		conn === 'live'
			? 'Поток событий оркестратора подключён'
			: conn === 'offline'
				? 'Оркестратор недоступен — повторяем попытки'
				: 'Подключаемся к оркестратору'
	return (
		<span className={`${s.conn} ${s[conn]} ${compact ? s.connCompact : ''}`} title={title} role="status">
			<StatusDot color={m.color} pulse={m.pulse} size={8} />
			<span className={compact ? 'sr-only' : s.connLabel}>{m.label}</span>
			{conn === 'offline' && (
				<Button size="sm" variant="ghost" icon="refresh" className={s.reconnect} onClick={reconnectNow} aria-label="Переподключить">
					{compact ? undefined : 'переподключить'}
				</Button>
			)}
		</span>
	)
}
