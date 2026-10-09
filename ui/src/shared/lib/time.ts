const pad = (n: number): string => String(n).padStart(2, '0')

/** Относительное время: «сейчас», «3 мин», «2 ч», «5 дн». */
export function ago(ts: number | string, now = Date.now()): string {
	const s = Math.max(0, Math.round((now - new Date(ts).getTime()) / 1000))
	if (s < 10) return 'сейчас'
	if (s < 60) return `${s} с`
	const m = Math.floor(s / 60)
	if (m < 60) return `${m} мин`
	const h = Math.floor(m / 60)
	if (h < 24) return `${h} ч`
	return `${Math.floor(h / 24)} дн`
}

/** Таймер «6:40» / «1:02:05» по миллисекундам (моноширинные счётчики). */
export function timer(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000))
	const h = Math.floor(s / 3600)
	const m = Math.floor((s % 3600) / 60)
	const x = s % 60
	return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`
}
