import type { RoleField } from '../model/types'

/** Куда отнести ошибку сервера по коду/тексту. */
export function roleFieldOf(code: string, message: string): RoleField {
	const c = code.toLowerCase()
	const m = message.toLowerCase()
	if (c.includes('instruction') || m.includes('инструкц')) return 'instructions'
	if (c.includes('name') || c.includes('exists') || c.includes('taken') || m.includes('имя') || m.includes('имени')) return 'name'
	if (c.includes('description') || m.includes('описани')) return 'description'
	return 'form'
}

/** Локальная проверка перед отправкой. */
export function validateRole(name: string, instructions: string): Partial<Record<RoleField, string>> {
	const out: Partial<Record<RoleField, string>> = {}
	if (!name.trim()) out.name = 'Назовите роль'
	if (!instructions.trim()) out.instructions = 'Напишите инструкции — они попадут во вводную агента'
	return out
}
