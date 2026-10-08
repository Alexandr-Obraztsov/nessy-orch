/**
 * HTTP + SSE API оркестратора (loopback). Без зависимостей.
 *
 *   GET  /health                      GET  /status                    GET /graph
 *   GET  /spaces                      POST /spaces {path,name?,url?}  DELETE /spaces/:name?force=1
 *   GET  /agents                      POST /agents  (spawn)           GET /agents/:ref   DELETE /agents/:ref
 *   POST /agents/:ref/send            POST /agents/:ref/cancel
 *   POST /agents/:ref/permission/:requestId {approve}
 *   GET  /agents/:ref/history         GET  /agents/:ref/stream (SSE)
 *   GET  /messages?agent=&since=&limit=
 *   GET  /inbox?wait=&peek=1&after=
 *   GET  /stream (SSE: snapshot + все события)
 * Всё остальное по GET — статика UI.
 */
import * as http from 'node:http'
import type { Orchestrator } from '../../application/orchestrator'
import { AppError } from '../../domain/errors'
import { errMsg } from '../../lib/json'
import { assertLocalClient } from './guard'
import { sendJson } from './respond'
import { Router } from './router'
import { registerAgentRoutes } from './routes/agents.routes'
import { registerMessageRoutes } from './routes/messages.routes'
import { registerSpaceRoutes } from './routes/spaces.routes'
import { registerSystemRoutes } from './routes/system.routes'
import type { ServerOptions } from './server.types'
import { serveStatic } from './static-files'

export function buildRouter(): Router {
	const r = new Router()
	registerSystemRoutes(r)
	registerSpaceRoutes(r)
	registerAgentRoutes(r)
	registerMessageRoutes(r)
	return r
}

function splitPath(p: string): string[] {
	try {
		return p.split('/').filter(Boolean).map(decodeURIComponent)
	} catch {
		throw new AppError(400, 'bad_path', 'некорректный путь')
	}
}

export function createServer(orch: Orchestrator, opts: ServerOptions): http.Server {
	const router = buildRouter()
	const apiRoots = router.roots()

	async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		assertLocalClient(req, opts.port)
		const url = new URL(req.url ?? '/', 'http://localhost')
		const method = req.method ?? 'GET'
		const seg = splitPath(url.pathname)

		if (method === 'GET' && !apiRoots.has(seg[0] ?? '')) {
			serveStatic(res, url.pathname, opts.uiDir)
			return
		}
		const hit = router.match(method, seg)
		if (!hit) throw new AppError(404, 'not_found', `${method} ${url.pathname}`)
		await hit.handler({ req, res, orch, opts, params: hit.params, query: url.searchParams })
	}

	return http.createServer((req, res) => {
		handle(req, res).catch((e: unknown) => {
			if (res.headersSent) {
				res.end()
				return
			}
			const status = e instanceof AppError ? e.status : 500
			const code = e instanceof AppError ? e.code : 'internal'
			sendJson(res, status, { error: errMsg(e), code })
		})
	})
}
