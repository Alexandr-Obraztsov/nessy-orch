/** Цвета ролей: 8 спокойных оттенков (hue), одинаково читаемых в обеих темах. */
export const ROLE_HUES = [262, 215, 185, 145, 45, 20, 350, 300] as const

export const roleColor = (hue: number): string => `hsl(${Math.round(hue)} 62% 60%)`
export const roleSoft = (hue: number): string => `hsl(${Math.round(hue)} 62% 60% / 0.16)`

/** Цвет по умолчанию для нового имени (как на сервере — стабильный хеш). */
export function hueFromName(name: string): number {
	let h = 0
	for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
	return ROLE_HUES[h % ROLE_HUES.length] ?? ROLE_HUES[0]
}
