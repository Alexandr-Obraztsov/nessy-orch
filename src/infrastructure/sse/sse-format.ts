/** Сформировать SSE-кадр для отправки клиенту. */
export function formatFrame(data: unknown, opts: { event?: string; id?: number | string } = {}): string {
	let s = ''
	if (opts.id !== undefined) s += `id: ${opts.id}\n`
	if (opts.event) s += `event: ${opts.event}\n`
	s += `data: ${JSON.stringify(data)}\n\n`
	return s
}
