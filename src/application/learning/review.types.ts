import type { ReviewReport } from '../../../shared/types'

/** Куда авто-ревью складывает отчёт (`PlaybookStorePort.saveReview`); у `PlaybookService` метод `saveReview` пока может отсутствовать. */
export interface ReviewSink {
	saveReview(r: ReviewReport): void
}

/** Правки улучшателя на ревью: хэши правок и версия плейбука до них (`payload` задания `review`). */
export interface ReviewEdits {
	hashes: string[]
	baseVersion: number
}
