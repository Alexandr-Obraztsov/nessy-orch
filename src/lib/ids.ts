import * as crypto from 'node:crypto'

const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Короткий читаемый идентификатор. */
export function rid(len = 4): string {
	const b = crypto.randomBytes(len)
	let s = ''
	for (const byte of b) s += ALPHA.charAt(byte % ALPHA.length)
	return s
}

/** Случайная hex-строка длины `len` (суффикс id задачи). */
export function hexId(len = 4): string {
	return crypto
		.randomBytes(Math.ceil(len / 2))
		.toString('hex')
		.slice(0, len)
}
