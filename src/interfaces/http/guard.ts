/**
 * Защита от DNS-rebinding и CSRF из браузера: агенты работают с автоподтверждением,
 * поэтому любая страница в браузере не должна уметь дёргать API.
 */
import type * as http from 'node:http'
import { AppError } from '../../domain/errors'

export function assertLocalClient(req: http.IncomingMessage, port: number): void {
	const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
	const host = (req.headers.host ?? '').toLowerCase()
	if (!allowedHosts.includes(host)) throw new AppError(403, 'bad_host', 'недопустимый Host')
	const origin = req.headers.origin
	if (origin !== undefined) {
		const o = origin.toLowerCase()
		if (o !== `http://127.0.0.1:${port}` && o !== `http://localhost:${port}`) throw new AppError(403, 'bad_origin', 'недопустимый Origin')
	}
}
