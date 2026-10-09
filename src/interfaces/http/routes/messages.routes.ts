/** Маршруты ленты и входящих. */
import { queryNum, sendJson } from '../respond'
import type { Router } from '../router'

export function registerMessageRoutes(r: Router): void {
	r.add('GET', '/messages', ({ res, orch, query }) => {
		const since = query.get('since')
		sendJson(
			res,
			200,
			orch.listMessages({
				agent: query.get('agent') ?? undefined,
				since: since === null ? undefined : queryNum(since, 0),
				limit: queryNum(query.get('limit'), 200),
			}),
		)
	})
	r.add('GET', '/inbox', async ({ res, orch, query }) => {
		const after = query.get('after')
		sendJson(
			res,
			200,
			await orch.inbox({
				task: query.get('task') ?? undefined,
				wait: queryNum(query.get('wait'), 0),
				peek: query.get('peek') === '1',
				after: after === null ? undefined : queryNum(after, 0),
			}),
		)
	})
}
