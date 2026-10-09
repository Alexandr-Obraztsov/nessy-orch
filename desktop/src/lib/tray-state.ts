/** Заголовок и анимация иконки строки меню. */
import type { AgentView } from '../../../shared/types'
import type { TrayStatus } from '../types'

/** Пауза между кадрами пульса: не чаще 4 кадров в секунду. */
export const PULSE_INTERVAL_MS = 280
/** Кадров в наборе иконок (assets/tray/tray-<n>Template.png). */
export const PULSE_FRAMES = 4

const isLive = (a: AgentView): boolean => !a.archived

export function trayStatus(agents: Iterable<AgentView>): TrayStatus {
	let working = 0
	let waiting = 0
	let count = 0
	for (const a of agents) {
		if (!isLive(a)) continue
		count++
		if (a.status === 'working' || a.status === 'starting') working++
		if (a.pendingPermissions.length > 0) waiting++
	}
	return { working, waiting, agents: count }
}

/** Текст рядом с иконкой: число работающих агентов и «●», если кто-то ждёт разрешения. */
export function trayTitle(s: TrayStatus): string {
	const parts: string[] = []
	if (s.working > 0) parts.push(String(s.working))
	if (s.waiting > 0) parts.push('●')
	return parts.length ? ' ' + parts.join(' ') : ''
}

/** Подсказка при наведении. */
export function trayTooltip(s: TrayStatus, offline: boolean): string {
	if (offline) return 'nessy — оркестратор недоступен'
	if (s.agents === 0) return 'nessy — агентов нет'
	const parts = [`в работе: ${s.working}`]
	if (s.waiting > 0) parts.push(`ждут разрешения: ${s.waiting}`)
	return `nessy — ${parts.join(', ')}`
}

/** Номер кадра для тика: «дыхание» 0→1→2→3→2→1→0…; без работы — всегда 0. */
export function pulseFrame(tick: number, active: boolean, frames: number = PULSE_FRAMES): number {
	if (!active || frames <= 1) return 0
	const period = 2 * (frames - 1)
	const t = ((Math.floor(tick) % period) + period) % period
	return t < frames ? t : period - t
}
