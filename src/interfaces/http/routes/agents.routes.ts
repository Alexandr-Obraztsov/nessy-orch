/** Маршруты агентов. */
import { parseApprove, parseModelRequest, parsePlanRequest, parseSendRequest, parseSpawnRequest } from '../parsers'
import { queryNum, readBody, sendJson } from '../respond'
import type { Router } from '../router'

export function registerAgentRoutes(r: Router): void {
	r.add('GET', '/agents', ({ res, orch, query }) => sendJson(res, 200, orch.listAgents(query.get('session') ?? undefined)))
	r.add('POST', '/agents', async ({ req, res, orch, caller }) => {
		const spawn = parseSpawnRequest(await readBody(req))
		orch.authorizeSender(spawn.from, caller)
		// агент без токена не выбирает родителя: он — тот, от чьего имени запрос
		if (!caller.operator) delete spawn.parent
		sendJson(res, 201, await orch.spawn(spawn))
	})
	r.add('GET', '/agents/:ref', ({ res, orch, params }) => sendJson(res, 200, orch.getAgent(params['ref'] ?? '')))
	r.add('GET', '/agents/:ref/wait', async ({ res, orch, params, query }) => {
		const sec = Number(query.get('timeout') ?? '0')
		sendJson(res, 200, await orch.waitAgent(params['ref'] ?? '', Number.isFinite(sec) ? Math.min(Math.max(sec, 0), 3600) : 0))
	})
	r.add('DELETE', '/agents/:ref', async ({ res, orch, params }) => {
		await orch.removeAgent(params['ref'] ?? '')
		sendJson(res, 200, { ok: true })
	})
	r.add('GET', '/agents/:ref/history', ({ res, orch, params, query }) =>
		sendJson(res, 200, orch.agentHistory(params['ref'] ?? '', queryNum(query.get('limit'), 400))),
	)
	r.add('POST', '/agents/:ref/send', async ({ req, res, orch, params, caller }) => {
		const send = parseSendRequest(await readBody(req))
		orch.authorizeSender(send.from, caller)
		sendJson(res, 200, await orch.send(params['ref'] ?? '', send))
	})
	r.add('POST', '/agents/:ref/archive', ({ res, orch, params }) => sendJson(res, 200, orch.archiveAgent(params['ref'] ?? '')))
	r.add('POST', '/agents/:ref/restore', ({ res, orch, params }) => sendJson(res, 200, orch.restoreAgent(params['ref'] ?? '')))
	r.add('POST', '/agents/:ref/cancel', async ({ res, orch, params }) => sendJson(res, 200, await orch.cancelAgent(params['ref'] ?? '')))
	r.add('POST', '/agents/:ref/model', async ({ req, res, orch, params }) => {
		sendJson(res, 200, await orch.setAgentModel(params['ref'] ?? '', parseModelRequest(await readBody(req))))
	})
	r.add('POST', '/agents/:ref/plan', async ({ req, res, orch, params, caller }) => {
		const plan = parsePlanRequest(await readBody(req))
		orch.authorizeSender(plan.from, caller)
		sendJson(res, 200, orch.setPlan(params['ref'] ?? '', plan))
	})
	r.add('DELETE', '/agents/:ref/plan', ({ res, orch, params, query, caller }) => {
		const from = query.get('from') ?? undefined
		orch.authorizeSender(from, caller)
		sendJson(res, 200, orch.setPlan(params['ref'] ?? '', { ...(from !== undefined ? { from } : {}), entries: null }))
	})
	r.add('POST', '/agents/:ref/permission/:requestId', async ({ req, res, orch, params }) => {
		const body = await readBody(req)
		const ok = await orch.resolvePermission(params['ref'] ?? '', params['requestId'] ?? '', parseApprove(body))
		sendJson(res, ok ? 200 : 404, { ok })
	})
}
