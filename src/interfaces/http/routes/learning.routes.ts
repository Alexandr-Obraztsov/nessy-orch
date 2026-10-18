/** Маршруты фонового обучения. Изменения доступны только оператору (`guard.assertAllowed`). */
import type { LearningService } from '../../../application/learning/learning.service'
import type { Orchestrator } from '../../../application/orchestrator'
import { AppError } from '../../../domain/errors'
import { parseBackfillRequest, parseLearningRun } from '../parsers'
import { readBody, sendJson } from '../respond'
import type { Router } from '../router'

/** Сервис обучения; хранилища нет — 503 `learning_unavailable`. */
function learning(orch: Orchestrator): LearningService {
	if (!orch.learning) throw new AppError(503, 'learning_unavailable', 'фоновое обучение недоступно: нет хранилища')
	return orch.learning
}

export function registerLearningRoutes(r: Router): void {
	r.add('GET', '/learning', ({ res, orch }) => sendJson(res, 200, learning(orch).view()))
	r.add('PATCH', '/learning/settings', async ({ req, res, orch }) => {
		const svc = learning(orch)
		sendJson(res, 200, svc.updateSettings(await readBody(req)))
	})
	r.add('POST', '/learning/run', async ({ req, res, orch }) => {
		const svc = learning(orch)
		const { session } = parseLearningRun(await readBody(req))
		sendJson(res, 200, session === undefined ? svc.runAll() : [svc.runNow(session)])
	})
	r.add('POST', '/learning/jobs/:id/retry', ({ res, orch, params }) => sendJson(res, 200, learning(orch).retry(params['id'] ?? '')))
	r.add('GET', '/learning/cases/:id', ({ res, orch, params }) => sendJson(res, 200, learning(orch).getCaseDetail(params['id'] ?? '')))
	r.add('DELETE', '/learning/cases/:id', ({ res, orch, params }) => {
		learning(orch).removeCase(params['id'] ?? '')
		sendJson(res, 200, { ok: true })
	})
	r.add('POST', '/learning/cases/:id/rebuild', ({ res, orch, params }) => sendJson(res, 200, learning(orch).rebuild(params['id'] ?? '')))
	r.add('GET', '/learning/backfill', ({ res, orch }) => sendJson(res, 200, learning(orch).backfillCandidates()))
	r.add('POST', '/learning/backfill', async ({ req, res, orch }) => {
		const svc = learning(orch)
		sendJson(res, 200, svc.backfill(parseBackfillRequest(await readBody(req))))
	})
}
