import type { LinkChip } from '../model/types'

const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+[^\s<>()[\]"'`.,;:!?]/g
const JIRA_RE = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g
const MR_RE = /(^|[\s(«"])!(\d{1,6})\b/g

/** Короткая подпись ссылки: хост + хвост пути. */
function shortUrl(u: string): string {
	try {
		const url = new URL(u)
		const path = url.pathname.replace(/\/$/, '')
		const tail = path.length > 28 ? `…${path.slice(-26)}` : path
		return `${url.host.replace(/^www\./, '')}${tail}`
	} catch {
		return u.length > 40 ? `${u.slice(0, 39)}…` : u
	}
}

/** Ссылки из текста ответа: URL, ключи Jira (ABC-123), MR (!123). Без повторов, не больше max. */
export function extractLinks(text: string, max = 12): LinkChip[] {
	const out: LinkChip[] = []
	const seen = new Set<string>()
	const add = (c: LinkChip): void => {
		if (seen.has(c.value) || out.length >= max) return
		seen.add(c.value)
		out.push(c)
	}
	const urls = text.match(URL_RE) ?? []
	for (const u of urls) add({ kind: 'url', label: shortUrl(u), value: u })
	// ключи Jira и MR ищем вне URL, чтобы не дублировать
	const rest = text.replace(URL_RE, ' ')
	for (const k of rest.match(JIRA_RE) ?? []) add({ kind: 'jira', label: k, value: k })
	for (const m of rest.matchAll(MR_RE)) add({ kind: 'mr', label: `!${m[2] ?? ''}`, value: `!${m[2] ?? ''}` })
	return out
}
