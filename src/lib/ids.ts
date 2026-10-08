import * as crypto from 'node:crypto'

const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Короткий читаемый идентификатор. */
export function rid(len = 4): string {
	const b = crypto.randomBytes(len)
	let s = ''
	for (const byte of b) s += ALPHA.charAt(byte % ALPHA.length)
	return s
}
