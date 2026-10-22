/** Имитация агента-сборщика в тестах: читает все блоки событий идущих заданий `collect`/`close` через `caseRead`. */
import type { LearningService } from '../../src/application/learning/learning.service'

export function drainReads(svc: LearningService | null): void {
	if (!svc) return
	for (const j of svc.view().jobs) {
		if (j.status !== 'running' || (j.kind !== 'collect' && j.kind !== 'close')) continue
		while (!svc.caseRead(j.caseId).done) {
			// блок за блоком, пока не done
		}
	}
}
