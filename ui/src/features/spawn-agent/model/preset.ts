/**
 * Предвыбранное пространство для диалога запуска (например, «+» в заголовке группы ростера).
 */
import { openDialog } from '@/shared/model'

let preset: string | null = null

/** Открыть диалог запуска агента, опционально — сразу в пространстве `space`. */
export function openSpawn(space?: string): void {
	preset = space ?? null
	openDialog('spawn')
}

/** Забрать предвыбор (одноразово). */
export function takeSpawnPreset(): string | null {
	const p = preset
	preset = null
	return p
}
