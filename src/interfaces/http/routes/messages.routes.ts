/** Маршруты ленты и входящих. */
import { queryNum, sendJson } from '../respond'
import type { Router } from '../router'

export function registerMessageRoutes(r: Router): void {
	r.add('GET', '/messages', ({ res, orch, query }) => {
		const since = query.get('since')
		const agent = query.get('agent')
		const sinceVal = since === null ? undefined : queryNum(since, 0)
		sendJson(
			res,
			200,
			orch.listMessages({
				...(agent ? { agent } : {}),
				...(sinceVal !== undefined ? { since: sinceVal } : {}),
				limit: queryNum(query.get('limit'), 200),
			}),
		)
	})
}
