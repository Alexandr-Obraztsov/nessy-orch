/**
 * Таймер «4:12»: живой (тикает раз в секунду), пока не задан конец, иначе статичный.
 * Моноширинные цифры; `stale` — жёлтый (от агента давно нет событий).
 */
import { timer } from '@/shared/lib/time'
import { useNow } from '@/shared/lib/useNow'
import s from './Elapsed.module.css'

export interface ElapsedProps {
	/** мс: начало */
	from: number
	/** мс: конец; null/undefined — идёт сейчас */
	to?: number | null
	/** функция «устарело» от текущего времени (для живого таймера) */
	stale?: (now: number) => boolean
	className?: string
	title?: string
}

function Live({ from, stale, className, title }: Omit<ElapsedProps, 'to'>) {
	const now = useNow(1000)
	const old = stale?.(now) ?? false
	return (
		<span className={[s.tm, old && s.stale, className].filter(Boolean).join(' ')} title={old ? 'Давно нет событий — возможно, завис' : title}>
			{timer(now - from)}
		</span>
	)
}

export function Elapsed({ from, to, stale, className, title }: ElapsedProps) {
	if (to === undefined || to === null) return <Live from={from} stale={stale} className={className} title={title} />
	return (
		<span className={[s.tm, className].filter(Boolean).join(' ')} title={title}>
			{timer(to - from)}
		</span>
	)
}

/** Прочерк на месте таймера. */
export function NoTimer({ className }: { className?: string }) {
	return <span className={[s.tm, className].filter(Boolean).join(' ')}>—</span>
}
