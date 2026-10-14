/** Маршруты сессий оркестраторов. */
import { AppError } from '../../../domain/errors'
import { isObject } from '../../../lib/json'
import { parseLeadState, parseSessionPatch, parseSessionRequest, parseSessionStatus } from '../parsers'
import { readBody, sendJson } from '../respond'
import type { Router } from '../router'

export function registerSessionRoutes(r: Router): void {
	r.add('GET', '/sessions', ({ res, orch, query }) => {
		const status = query.get('status')
		sendJson(res, 200, orch.listSessions(status === null ? undefined : parseSessionStatus(status)))
	})
	r.add('POST', '/sessions', async ({ req, res, orch }) => {
		const body = await readBody(req)
		sendJson(res, 201, orch.createSession(parseSessionRequest(body)))
	})
	r.add('GET', '/sessions/:id', ({ res, orch, params }) => sendJson(res, 200, orch.getSession(params['id'] ?? '')))
	r.add('GET', '/sessions/:id/sources', ({ res, orch, params }) => sendJson(res, 200, orch.sessionSources(params['id'] ?? '')))
	r.add('GET', '/sessions/:id/updates', async ({ res, orch, params, query }) =>
		sendJson(res, 200, await orch.sessionUpdates(params['id'] ?? '', query.get('consume') === '1')),
	)
	r.add('POST', '/sessions/:id/ack', async ({ req, res, orch, params }) => {
		const b = await readBody(req)
		const cursor = isObject(b) && typeof b['cursor'] === 'number' && Number.isFinite(b['cursor']) ? b['cursor'] : null
		if (cursor === null) throw new AppError(400, 'bad_request', 'нужно число cursor')
		orch.ackSession(params['id'] ?? '', cursor)
		sendJson(res, 200, { ok: true })
	})
	r.add('POST', '/sessions/bind', async ({ req, res, orch }) => {
		const b = await readBody(req)
		const o = isObject(b) ? b : {}
		const str = (k: string): string => (typeof o[k] === 'string' ? o[k] : '')
		sendJson(res, 200, orch.bindChat(str('chatId'), str('session') || null, str('title'), str('terminal') || null, str('cwd') || null))
	})
	r.add('POST', '/sessions/:id/lead-state', async ({ req, res, orch, params }) => {
		const body = await readBody(req)
		sendJson(res, 200, orch.setLeadState(params['id'] ?? '', parseLeadState(body)))
	})
	r.add('PATCH', '/sessions/:id', async ({ req, res, orch, params }) => {
		const body = await readBody(req)
		sendJson(res, 200, orch.updateSession(params['id'] ?? '', parseSessionPatch(body)))
	})
	r.add('DELETE', '/sessions/:id', ({ res, orch, params }) => {
		orch.removeSession(params['id'] ?? '')
		sendJson(res, 200, { ok: true })
	})
}
