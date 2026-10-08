import * as net from 'node:net'

/** Найти свободный loopback-порт начиная с `from`. */
export function freePort(from: number, used: ReadonlySet<number> = new Set()): Promise<number> {
	return new Promise((resolve, reject) => {
		const tryPort = (p: number): void => {
			if (p > 65000) {
				reject(new Error('нет свободных портов'))
				return
			}
			if (used.has(p)) {
				tryPort(p + 1)
				return
			}
			const s = net.createServer()
			s.once('error', () => tryPort(p + 1))
			s.listen(p, '127.0.0.1', () => s.close(() => resolve(p)))
		}
		tryPort(from)
	})
}
