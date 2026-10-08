const pad = (n: number): string => String(n).padStart(2, '0')

/** «14:05» или «вчера 14:05» / «12.10 14:05». */
export function clock(ts: number | string): string {
	const d = new Date(ts)
	const now = new Date()
	const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
	if (d.toDateString() === now.toDateString()) return hm
	const y = new Date(now)
	y.setDate(now.getDate() - 1)
	if (d.toDateString() === y.toDateString()) return `вчера ${hm}`
	return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${hm}`
}

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

/** Длительность «1:07» / «12 с». */
export function duration(fromTs: number | string, now = Date.now()): string {
	const s = Math.max(0, Math.round((now - new Date(fromTs).getTime()) / 1000))
	if (s < 60) return `${s} с`
	const m = Math.floor(s / 60)
	if (m < 60) return `${m}:${pad(s % 60)}`
	return `${Math.floor(m / 60)} ч ${pad(m % 60)} мин`
}

/** Начало дня (для разделителей ленты). */
export function dayKey(ts: number): string {
	return new Date(ts).toDateString()
}

export function dayLabel(ts: number): string {
	const d = new Date(ts)
	const now = new Date()
	if (d.toDateString() === now.toDateString()) return 'Сегодня'
	const y = new Date(now)
	y.setDate(now.getDate() - 1)
	if (d.toDateString() === y.toDateString()) return 'Вчера'
	return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}
