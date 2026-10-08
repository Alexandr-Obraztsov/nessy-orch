/** Маршруты пространств. */
import { parseSpaceRequest } from '../parsers'
import { readBody, sendJson } from '../respond'
import type { Router } from '../router'

export function registerSpaceRoutes(r: Router): void {
	r.add('GET', '/spaces', ({ res, orch }) => sendJson(res, 200, orch.graph().spaces))
	r.add('POST', '/spaces', async ({ req, res, orch }) => {
		const body = await readBody(req)
		sendJson(res, 201, orch.addSpace(parseSpaceRequest(body)))
	})
	r.add('DELETE', '/spaces/:name', async ({ res, orch, params, query }) => {
		await orch.removeSpace(params['name'] ?? '', query.get('force') === '1')
		sendJson(res, 200, { ok: true })
	})
}
