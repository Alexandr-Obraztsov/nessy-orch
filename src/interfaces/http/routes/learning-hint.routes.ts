/** Подсказка плейбука для хука UserPromptSubmit терминала приложения. Только читает и помечает подсказанное, поэтому без `guard`. */
import { hintFor } from '../../../application/learning/hint'
import { AppError } from '../../../domain/errors'
import { isObject } from '../../../lib/json'
import { readBody, sendJson } from '../respond'
import type { Router } from '../router'

export function registerLearningHintRoutes(r: Router): void {
	r.add('POST', '/learning/hint', async ({ req, res, orch }) => {
		const b = await readBody(req)
		const session = isObject(b) ? b['session'] : undefined
		const prompt = isObject(b) ? b['prompt'] : undefined
		if (typeof session !== 'string' || !session || typeof prompt !== 'string') throw new AppError(400, 'bad_request', 'нужны поля session и prompt (строки)')
		// обучение недоступно или выключено — подсказки нет, это не ошибка для хука
		if (!orch.learning) return sendJson(res, 200, { playbook: null })
		sendJson(res, 200, hintFor(orch.learning.hints, session, prompt))
	})
}
