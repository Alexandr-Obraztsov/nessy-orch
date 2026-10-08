/** Русское склонение по числу: plural(3, 'агент', 'агента', 'агентов') → «3 агента». */
export function plural(n: number, one: string, few: string, many: string): string {
	const m100 = n % 100
	const m10 = n % 10
	const w = m100 > 10 && m100 < 20 ? many : m10 === 1 ? one : m10 > 1 && m10 < 5 ? few : many
	return `${n} ${w}`
}
