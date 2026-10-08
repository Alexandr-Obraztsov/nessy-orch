import type { PermissionOption } from './types'

/** Выбрать вариант ответа на запрос разрешения. approve=false → отклонить. */
export function pickPermissionOption(options: readonly PermissionOption[], approve: boolean): string | null {
	const opts = options.filter(o => o.optionId)
	const match = (re: RegExp): PermissionOption | undefined => opts.find(o => re.test(o.kind) || re.test(o.optionId))
	if (approve) {
		const hit =
			match(/^allow_once$/) ??
			match(/^allow_always$/) ??
			match(/allow|proceed|approve|yes/i) ??
			opts.find(o => !/cancel|reject|deny|no/i.test(o.optionId)) ??
			opts[0]
		return hit?.optionId ?? null
	}
	return (match(/^reject_once$/) ?? match(/reject|deny|no/i))?.optionId ?? null
}
