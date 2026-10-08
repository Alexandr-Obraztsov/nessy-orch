/** Маршруты агентов. */
import { parseApprove, parseSendRequest, parseSpawnRequest } from '../parsers'
import { queryNum, readBody, sendJson } from '../respond'
import type { Router } from '../router'

export function registerAgentRoutes(r: Router): void {
	r.add('GET', '/agents', ({ res, orch }) => sendJson(res, 200, orch.graph().agents))
	r.add('POST', '/agents', async ({ req, res, orch }) => {
		const body = await readBody(req)
		sendJson(res, 201, await orch.spawn(parseSpawnRequest(body)))
	})
	r.add('GET', '/agents/:ref', ({ res, orch, params }) => sendJson(res, 200, orch.getAgent(params['ref'] ?? '')))
	r.add('DELETE', '/agents/:ref', async ({ res, orch, params }) => {
		await orch.removeAgent(params['ref'] ?? '')
		sendJson(res, 200, { ok: true })
	})
	r.add('GET', '/agents/:ref/history', ({ res, orch, params, query }) =>
		sendJson(res, 200, orch.agentHistory(params['ref'] ?? '', queryNum(query.get('limit'), 400))),
	)
	r.add('POST', '/agents/:ref/send', async ({ req, res, orch, params }) => {
		const body = await readBody(req)
		sendJson(res, 200, await orch.send(params['ref'] ?? '', parseSendRequest(body)))
	})
	r.add('POST', '/agents/:ref/archive', ({ res, orch, params }) => sendJson(res, 200, orch.archiveAgent(params['ref'] ?? '')))
	r.add('POST', '/agents/:ref/restore', ({ res, orch, params }) => sendJson(res, 200, orch.restoreAgent(params['ref'] ?? '')))
	r.add('POST', '/agents/:ref/cancel', async ({ res, orch, params }) => sendJson(res, 200, await orch.cancelAgent(params['ref'] ?? '')))
	r.add('POST', '/agents/:ref/permission/:requestId', async ({ req, res, orch, params }) => {
		const body = await readBody(req)
		const ok = await orch.resolvePermission(params['ref'] ?? '', params['requestId'] ?? '', parseApprove(body))
		sendJson(res, ok ? 200 : 404, { ok })
	})
}
