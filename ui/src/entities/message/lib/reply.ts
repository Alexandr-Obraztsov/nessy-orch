/**
 * Разбор итогового ответа агента по общему формату ролей (вводная nessy-orch):
 * раздел «Источники» → чипы (URL — ссылки, `путь:строка` и команды — текстовые чипы),
 * последняя строка «Статус: DONE | … — причина» → бейдж. Остальное показывается как markdown.
 */
import type { ParsedReply, ReplyStatus, SourceChip } from '../model/types'

const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+/
const HEAD_RE = /^\s*(?:[-*+]\s+)?(?:#{1,6}\s*)?(?:\*\*|__)?\s*Источники\s*(?:\*\*|__)?\s*(?:[:：—–-]\s*)?(?:\*\*|__)?\s*(.*)$/i
const STATUS_RE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?Статус(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__|`)?\s*(DONE_WITH_CONCERNS|DONE|BLOCKED|NEEDS_CONTEXT)\s*(?:\*\*|__|`)?\s*(?:[-—–:]\s*(.*))?$/
const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+[^\s<>()[\]"'`.,;:!?»]/g
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
/** начало следующего поля ответа в виде пункта списка: «- **Не проверено** — …» (без ссылки) */
const isField = (body: string): boolean => /^(?:\*\*|__)[^*_]+(?:\*\*|__)/.test(body.trim()) && !/https?:\/\//.test(body)

const MAX_LABEL = 48

function clip(s: string, n = MAX_LABEL): string {
	return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** Короткая подпись ссылки: последний сегмент пути («PLAT-77»), у чисел — с предыдущим («pipelines/48213»). */
export function shortUrl(u: string): string {
	try {
		const url = new URL(u)
		const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean)
		const last = parts[parts.length - 1]
		if (!last) return clip(url.host.replace(/^www\./, ''))
		const tail = /^\d+$/.test(last) || last.length < 4 ? parts.slice(-2).join('/') : last
		return clip(`${tail}${url.hash}`)
	} catch {
		return clip(u)
	}
}

export function hostOf(u: string): string {
	try {
		return new URL(u).host.replace(/^www\./, '')
	} catch {
		return ''
	}
}

/** Подпись из текста пункта без ссылки: «MR !12 — https://…» → «MR !12». */
function restLabel(text: string): string {
	return text
		.replace(/`([^`]+)`/g, '$1')
		.replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1')
		.replace(/^\s*\[\d+\]\s*/, '')
		.replace(/\(\s*\+?\s*(?:permalink|ссылка)?\s*\)/gi, '')
		.replace(/\s*\+?\s*permalink\s*/gi, ' ')
		.replace(/^[\s:—–-]+|[\s:—–(,-]+$/g, '')
		.trim()
}

/** Чипы из одного пункта списка источников. */
function chipsOf(item: string): SourceChip[] {
	const out: SourceChip[] = []
	let rest = item
	for (const m of item.matchAll(MD_LINK_RE)) {
		const [all, label = '', href = ''] = m
		out.push({ kind: 'url', label: clip(restLabel(label) || shortUrl(href)), href, host: hostOf(href) })
		rest = rest.replace(all, ' ')
	}
	const urls = rest.match(URL_RE) ?? []
	for (const u of urls) rest = rest.replace(u, ' ')
	const label = restLabel(rest)
	urls.forEach((href, i) => {
		// подпись пункта достаётся первой ссылке, если она короткая и осмысленная
		const own = i === 0 && label && label.length <= MAX_LABEL && out.length === 0 ? label : ''
		out.push({ kind: 'url', label: own || shortUrl(href), href, host: hostOf(href) })
	})
	if (out.length === 0 && label) out.push({ kind: 'text', label: clip(label, 72) })
	return out
}

export function parseReply(text: string): ParsedReply {
	const lines = text.replace(/\r\n/g, '\n').split('\n')
	let status: ParsedReply['status'] = null
	// «Статус: …» — последняя содержательная строка
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i] ?? ''
		if (!line.trim()) continue
		const m = STATUS_RE.exec(line)
		if (m) {
			status = { code: (m[1] ?? 'DONE') as ReplyStatus, reason: (m[2] ?? '').replace(/[*_`]/g, '').trim() }
			lines.splice(i, 1)
		}
		break
	}

	const sources: SourceChip[] = []
	const head = lines.findIndex(l => HEAD_RE.test(l))
	if (head !== -1) {
		const items: string[] = []
		const inline = (HEAD_RE.exec(lines[head] ?? '')?.[1] ?? '').trim()
		if (inline) items.push(...inline.split(/[;,]\s+(?=https?:|`)/))
		let end = head + 1
		for (; end < lines.length; end++) {
			const line = lines[end] ?? ''
			if (!line.trim()) {
				// пустая строка внутри списка допустима, если дальше он продолжается
				const next = lines.slice(end + 1).find(l => l.trim())
				if (next !== undefined && LIST_RE.test(next) && !isField(next.replace(LIST_RE, ''))) continue
				break
			}
			if (LIST_RE.test(line)) {
				const body = line.replace(LIST_RE, '')
				if (isField(body)) break
				items.push(body)
			} else if (/^\s{2,}\S/.test(line) && items.length > 0) items.push(`${items.pop() ?? ''} ${line.trim()}`)
			else break
		}
		for (const it of items) sources.push(...chipsOf(it))
		if (sources.length > 0) lines.splice(head, end - head)
	}

	// без повторов (одна и та же ссылка в нескольких пунктах)
	const seen = new Set<string>()
	const unique = sources.filter(c => {
		const k = c.kind === 'url' ? c.href : c.label
		if (seen.has(k)) return false
		seen.add(k)
		return true
	})
	return { body: lines.join('\n').trim(), sources: unique, status }
}

export const STATUS_LABEL: Record<ReplyStatus, string> = {
	DONE: 'Готово',
	DONE_WITH_CONCERNS: 'Готово с оговорками',
	BLOCKED: 'Заблокировано',
	NEEDS_CONTEXT: 'Нужен контекст',
}

/** Две буквы источника по хосту: GitLab → GL, Jira → JI, Wiki → WK, Sage → SG. */
export function hostBadge(host: string): { text: string; hue: number } {
	const h = host.toLowerCase()
	if (h.includes('gitlab')) return { text: 'GL', hue: 18 }
	if (h.includes('github')) return { text: 'GH', hue: 260 }
	if (h.includes('jira')) return { text: 'JI', hue: 215 }
	if (h.includes('wiki') || h.includes('confluence')) return { text: 'WK', hue: 150 }
	if (h.includes('sage')) return { text: 'SG', hue: 280 }
	let hash = 0
	for (const ch of h) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
	return { text: (h[0] ?? '?').toUpperCase(), hue: hash % 360 }
}
