/** Маршруты задач оркестраторов. */
import { parseTaskPatch, parseTaskRequest, parseTaskStatus } from '../parsers'
import { readBody, sendJson } from '../respond'
import type { Router } from '../router'

export function registerTaskRoutes(r: Router): void {
	r.add('GET', '/tasks', ({ res, orch, query }) => {
		const status = query.get('status')
		sendJson(res, 200, orch.listTasks(status === null ? undefined : parseTaskStatus(status)))
	})
	r.add('POST', '/tasks', async ({ req, res, orch }) => {
		const body = await readBody(req)
		sendJson(res, 201, orch.createTask(parseTaskRequest(body)))
	})
	r.add('GET', '/tasks/:id', ({ res, orch, params }) => sendJson(res, 200, orch.getTask(params['id'] ?? '')))
	r.add('PATCH', '/tasks/:id', async ({ req, res, orch, params }) => {
		const body = await readBody(req)
		sendJson(res, 200, orch.updateTask(params['id'] ?? '', parseTaskPatch(body)))
	})
	r.add('DELETE', '/tasks/:id', ({ res, orch, params }) => {
		orch.removeTask(params['id'] ?? '')
		sendJson(res, 200, { ok: true })
	})
}
