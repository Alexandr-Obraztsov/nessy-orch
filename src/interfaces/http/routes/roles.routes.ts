/** Маршруты ролей. */
import { parseRoleRequest } from '../parsers'
import { readBody, sendJson } from '../respond'
import type { Router } from '../router'

export function registerRoleRoutes(r: Router): void {
	r.add('GET', '/roles', ({ res, orch }) => sendJson(res, 200, orch.listRoles()))
	r.add('POST', '/roles', async ({ req, res, orch }) => {
		const body = await readBody(req)
		sendJson(res, 201, orch.createRole(parseRoleRequest(body)))
	})
	r.add('GET', '/roles/:id', ({ res, orch, params }) => sendJson(res, 200, orch.getRole(params['id'] ?? '')))
	r.add('PUT', '/roles/:id', async ({ req, res, orch, params }) => {
		const body = await readBody(req)
		sendJson(res, 200, orch.updateRole(params['id'] ?? '', parseRoleRequest(body)))
	})
	r.add('DELETE', '/roles/:id', ({ res, orch, params }) => {
		orch.removeRole(params['id'] ?? '')
		sendJson(res, 200, { ok: true })
	})
}
