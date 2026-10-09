/** Адреса UI внутри приложения. */
import type { DesktopMode } from '../preload.types'

/**
 * URL UI для режима: `<base>/?desktop=<mode>` + параметры из query ('?task=a&agent=b').
 * Параметр desktop всегда наш — из query его не берём.
 */
export function uiUrl(base: string, mode: DesktopMode, query = ''): string {
	const q = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
	const out = new URLSearchParams()
	out.set('desktop', mode)
	for (const [k, v] of q) if (k !== 'desktop') out.append(k, v)
	return `${base.replace(/\/+$/, '')}/?${out.toString()}`
}

/** Безопасный query от рендерера: строка до 1000 символов вида '?a=b' (или пустая). */
export function sanitizeQuery(v: unknown): string {
	if (typeof v !== 'string' || v.length > 1000) return ''
	const s = v.trim()
	if (s === '' || s === '?') return ''
	return s.startsWith('?') ? s : '?' + s
}

/** Принадлежит ли адрес оркестратору (навигация внутри окна разрешена только туда). */
export function sameOrigin(url: string, base: string): boolean {
	try {
		return new URL(url).origin === new URL(base).origin
	} catch {
		return false
	}
}
