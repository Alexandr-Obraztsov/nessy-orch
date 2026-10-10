/**
 * Источники сессии (чистые функции): ссылки из вызовов инструментов и из итоговых ответов агентов.
 * Разбор раздела «Источники» ответа — domain/reply.ts; здесь — выбор ссылок из входа инструмента и ключ дедупликации.
 */
import type { SourceChip } from './reply'
import { hostOf, shortUrl } from './reply'

const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+[^\s<>()[\]"'`.,;:!?»]/g
const MAX_PER_CALL = 5
const MAX_DEPTH = 3

/** Ссылки в строковых значениях входа инструмента (url, query, command, вложенные объекты). */
export function urlsInInput(input: unknown, depth = 0, out: string[] = []): string[] {
	if (out.length >= MAX_PER_CALL || depth > MAX_DEPTH) return out
	if (typeof input === 'string') {
		for (const m of input.matchAll(URL_RE)) {
			if (out.length >= MAX_PER_CALL) break
			if (!out.includes(m[0])) out.push(m[0])
		}
	} else if (Array.isArray(input)) {
		for (const v of input as unknown[]) urlsInInput(v, depth + 1, out)
	} else if (typeof input === 'object' && input !== null) {
		for (const v of Object.values(input)) urlsInInput(v, depth + 1, out)
	}
	return out
}

/** Чипы источников из списка URL (для инструментов). */
export function urlChips(urls: readonly string[]): SourceChip[] {
	return urls.map(href => ({ kind: 'url', label: shortUrl(href), href, host: hostOf(href) }))
}

/** Ключ дедупликации: URL без якоря и хвостового слэша либо текст ссылки на код/команду. */
export function sourceKey(c: SourceChip): string {
	if (c.kind === 'text') return `t:${c.label.toLowerCase()}`
	return `u:${c.href.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()}`
}
