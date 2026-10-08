/** Русское склонение по числу: plural(5, ['агент', 'агента', 'агентов']) → «агентов». */
export function plural(n: number, forms: readonly [string, string, string]): string {
	const a = Math.abs(n) % 100
	const b = a % 10
	if (a > 10 && a < 20) return forms[2]
	if (b > 1 && b < 5) return forms[1]
	if (b === 1) return forms[0]
	return forms[2]
}
