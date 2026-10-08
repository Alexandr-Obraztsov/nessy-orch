/** Дождаться условия (опрос каждые 20 мс). */
export async function until(cond: () => boolean, ms = 8000, what = 'условие'): Promise<void> {
	const t0 = Date.now()
	while (!cond()) {
		if (Date.now() - t0 > ms) throw new Error(`таймаут ожидания: ${what}`)
		await new Promise(r => setTimeout(r, 20))
	}
}
