/** Маршруты фонового обучения. Изменения доступны только оператору (`guard.assertAllowed`), кроме `POST …/draft` (его зовёт агент-сборщик по ключу). */
import type { PlaybookStatus } from '../../../../shared/types'
import type { LearningService } from '../../../application/learning/learning.service'
import type { Orchestrator } from '../../../application/orchestrator'
import { AppError } from '../../../domain/errors'
import { parseLearningRun, parsePlaybookPatch, parsePlaybookStatus, parseRawRange, parseReason, parseSummaryPut, parseTextBody, parseVersion } from '../parsers'
import { queryNum, readBody, sendJson } from '../respond'
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
	r.add('POST', '/learning/jobs/:id/cancel', ({ res, orch, params }) => sendJson(res, 200, learning(orch).cancelJob(params['id'] ?? '')))
	r.add('GET', '/learning/jobs/:id', ({ res, orch, params }) => sendJson(res, 200, learning(orch).jobDetail(params['id'] ?? '')))
	r.add('GET', '/learning/cases/:id/raw', ({ res, orch, params, query }) => {
		const { from, to } = parseRawRange(query.get('from'), query.get('to'))
		sendJson(res, 200, learning(orch).caseRaw(params['id'] ?? '', from, to))
	})
	r.add('GET', '/learning/cases/:id/read', ({ res, orch, params }) => sendJson(res, 200, learning(orch).caseRead(params['id'] ?? '')))
	r.add('POST', '/learning/cases/:id/draft', async ({ req, res, orch, params, caller, query }) => {
		const svc = learning(orch)
		const body = await readBody(req)
		const id = params['id'] ?? ''
		// агент по ключу (`from` + `key`) — только сборщик этого кейса; оператору можно всё
		if (!caller.operator) {
			const from = typeof body === 'object' && body !== null && 'from' in body && typeof body.from === 'string' ? body.from : undefined
			orch.authorizeSender(from, caller)
			svc.assertCollector(id, orch.resolveAgent(from ?? '').id)
		}
		// `?final=1` — итоговая консолидация после `done`
		sendJson(res, 200, svc.caseDraft(id, parseTextBody(body, true), query.get('final') === '1'))
	})
	r.add('GET', '/learning/cases/:id/impact', ({ res, orch, params }) => sendJson(res, 200, learning(orch).caseImpact(params['id'] ?? '')))
	r.add('PUT', '/learning/cases/:id/summary', async ({ req, res, orch, params }) => {
		const svc = learning(orch)
		const { text, base } = parseSummaryPut(await readBody(req))
		svc.setCaseSummary(params['id'] ?? '', text, base)
		sendJson(res, 200, { ok: true })
	})
	r.add('POST', '/learning/cases/:id/collector/stop', ({ res, orch, params }) => {
		learning(orch).stopCollector(params['id'] ?? '')
		sendJson(res, 200, { ok: true })
	})
	r.add('GET', '/learning/cases/:id', ({ res, orch, params }) => sendJson(res, 200, learning(orch).getCaseDetail(params['id'] ?? '')))
	r.add('DELETE', '/learning/cases/:id', ({ res, orch, params }) => {
		learning(orch).removeCase(params['id'] ?? '')
		sendJson(res, 200, { ok: true })
	})
	r.add('POST', '/learning/cases/:id/rebuild', ({ res, orch, params }) => sendJson(res, 200, learning(orch).rebuild(params['id'] ?? '')))

	// ---------- плейбуки, журнал, заметки и чат ----------
	r.add('GET', '/learning/playbooks', ({ res, orch }) => sendJson(res, 200, learning(orch).playbookList()))
	r.add('GET', '/learning/playbooks/:id', ({ res, orch, params }) => sendJson(res, 200, learning(orch).playbookDetail(params['id'] ?? '')))
	r.add('PATCH', '/learning/playbooks/:id', async ({ req, res, orch, params }) => {
		const svc = learning(orch)
		sendJson(res, 200, svc.patchPlaybook(params['id'] ?? '', parsePlaybookPatch(await readBody(req))))
	})
	r.add('POST', '/learning/playbooks/:id/review', ({ res, orch, params }) => sendJson(res, 200, learning(orch).requestReview(params['id'] ?? '')))
	r.add('POST', '/learning/playbooks/:id/approve', ({ res, orch, params }) => sendJson(res, 200, learning(orch).approvePlaybook(params['id'] ?? '')))
	r.add('POST', '/learning/playbooks/:id/reject', async ({ req, res, orch, params }) => {
		const svc = learning(orch)
		sendJson(res, 200, svc.rejectPlaybook(params['id'] ?? '', parseReason(await readBody(req))))
	})
	r.add('POST', '/learning/playbooks/:id/status', async ({ req, res, orch, params }) => {
		const svc = learning(orch)
		sendJson(res, 200, svc.setPlaybookStatus(params['id'] ?? '', parsePlaybookStatus(await readBody(req)) as PlaybookStatus))
	})
	r.add('POST', '/learning/playbooks/:id/revert', async ({ req, res, orch, params }) => {
		const svc = learning(orch)
		sendJson(res, 200, svc.revertPlaybook(params['id'] ?? '', parseVersion(await readBody(req))))
	})
	r.add('POST', '/learning/playbooks/:id/edits/:hash/accept', ({ res, orch, params }) => sendJson(res, 200, learning(orch).acceptEdit(params['id'] ?? '', params['hash'] ?? '')))
	r.add('POST', '/learning/playbooks/:id/edits/:hash/reject', ({ res, orch, params }) => sendJson(res, 200, learning(orch).rejectEdit(params['id'] ?? '', params['hash'] ?? '')))
	r.add('DELETE', '/learning/playbooks/:id', ({ res, orch, params }) => {
		learning(orch).removePlaybook(params['id'] ?? '')
		sendJson(res, 200, { ok: true })
	})
	r.add('PUT', '/learning/playbooks/:id/notes', async ({ req, res, orch, params }) => {
		const svc = learning(orch)
		svc.setPlaybookNotes(params['id'] ?? '', parseTextBody(await readBody(req), true))
		sendJson(res, 200, { ok: true })
	})
	r.add('PUT', '/learning/cases/:id/notes', async ({ req, res, orch, params }) => {
		const svc = learning(orch)
		svc.setCaseNotes(params['id'] ?? '', parseTextBody(await readBody(req), true))
		sendJson(res, 200, { ok: true })
	})
	r.add('GET', '/learning/journal', ({ res, orch, query }) => sendJson(res, 200, learning(orch).journal(queryNum(query.get('limit'), 200))))
	r.add('POST', '/learning/journal/:id/revert', ({ res, orch, params }) => sendJson(res, 200, learning(orch).revertJournal(params['id'] ?? '')))
	r.add('GET', '/learning/chat/:subject', ({ res, orch, params, query }) => sendJson(res, 200, learning(orch).chatOf(params['subject'] ?? '', queryNum(query.get('limit'), 200))))
	r.add('POST', '/learning/chat/:subject', async ({ req, res, orch, params }) => {
		const svc = learning(orch)
		sendJson(res, 200, svc.postChat(params['subject'] ?? '', parseTextBody(await readBody(req))))
	})
}
