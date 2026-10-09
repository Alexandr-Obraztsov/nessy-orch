/** «0.4 с», «12 с», «1:07». */
export function formatMs(ms: number): string {
	if (ms < 1000) return `${Math.max(0.1, Math.round(ms / 100) / 10)} с`
	const s = Math.round(ms / 1000)
	if (s < 60) return `${s} с`
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
