/** Служебные маршруты и потоки. */
import type { Router } from '../router'
import { sendJson } from '../respond'
import { streamAgent, streamAll } from '../sse-endpoints'

export function registerSystemRoutes(r: Router): void {
	r.add('GET', '/health', ({ res }) => sendJson(res, 200, { status: 'ok' }))
	r.add('GET', '/status', ({ res, orch, opts }) => sendJson(res, 200, orch.status(opts.version)))
	r.add('GET', '/graph', ({ res, orch }) => sendJson(res, 200, orch.graph()))
	r.add('GET', '/stream', ({ req, res, orch }) => streamAll(orch, req, res))
	r.add('GET', '/agents/:ref/stream', ({ req, res, orch, params }) => streamAgent(orch, req, res, params['ref'] ?? ''))
}
