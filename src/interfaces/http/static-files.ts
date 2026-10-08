/** Раздача собранного UI. */
import * as fs from 'node:fs'
import type * as http from 'node:http'
import * as path from 'node:path'
import { AppError } from '../../domain/errors'

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
}

export function serveStatic(res: http.ServerResponse, urlPath: string, root: string): void {
	const rel = urlPath === '/' ? '/index.html' : urlPath
	const file = path.normalize(path.join(root, rel))
	if (!file.startsWith(root + path.sep) && file !== root) throw new AppError(403, 'forbidden', 'вне каталога UI')
	let data: Buffer
	try {
		data = fs.readFileSync(file)
	} catch {
		throw new AppError(
			404,
			'not_found',
			fs.existsSync(root) ? rel : 'UI не найден (ожидается собранный UI в ' + root + ', см. ui/README.md)',
		)
	}
	res.writeHead(200, {
		'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
		'Cache-Control': 'no-store',
	})
	res.end(data)
}
