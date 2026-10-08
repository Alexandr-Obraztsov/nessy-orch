/**
 * Несохранённые правки ролей переживают переключение вкладок (вкладка размонтируется).
 * Ключ — id роли или '' для новой.
 */
import type { RoleDraft } from './types'

const drafts = new Map<string, RoleDraft>()

export const draftKey = (id: string | null): string => id ?? ''

export function getDraft(id: string | null): RoleDraft | undefined {
	return drafts.get(draftKey(id))
}

export function putDraft(id: string | null, d: RoleDraft | null): void {
	if (d) drafts.set(draftKey(id), d)
	else drafts.delete(draftKey(id))
}
