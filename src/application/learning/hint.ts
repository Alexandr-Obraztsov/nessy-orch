/** Подсказка плейбука в начале хода пользователя (хук UserPromptSubmit): подбор по тексту запроса и целям кейса. */
import { buildIndex, search } from '../../domain/learning-search'
import type { HintHost } from './handlers.types'
import type { PlaybookState } from './learning.types'

/** Минимальная оценка BM25 (см. подбор в `learning-hint.test.ts`): два-три общих значимых слова с описанием плейбука. */
export const HINT_MIN_SCORE = 2.5

/** Индекс из трёх плейбуков даёт вырожденный idf; добираем пустышками средней длины, чтобы оценка не зависела от числа плейбуков. */
const MIN_DOCS = 10

const isLive = (p: PlaybookState): boolean => p.status === 'trial' || p.status === 'active'

/** Подходящий плейбук `trial`/`active` или null; уже подсказанные (`hinted`) не повторяются. */
export function suggest(input: { session: string; prompt: string; caseGoalTypes: string[] }, playbooks: PlaybookState[], hinted: ReadonlySet<string>): PlaybookState | null {
	const live = playbooks.filter(p => isLive(p) && !hinted.has(p.id))
	if (!live.length) return null
	const query = [input.prompt, ...input.caseGoalTypes].join(' ')
	const ix = buildIndex(live.map(p => ({ id: p.id, text: `${p.description} ${p.taskType} ${p.title}` })))
	for (let i = ix.docs.length; i < MIN_DOCS; i++) ix.docs.push({ id: '', tf: new Map(), len: Math.round(ix.avgLen) })
	const best = search(ix, query, 1)[0]
	if (!best || best.score < HINT_MIN_SCORE) return null
	return live.find(p => p.id === best.id) ?? null
}

/** Подсказка для запроса сессии: сперва очередь сборщика, затем поиск. Найденная помечается как подсказанная. */
export function hintFor(host: HintHost, session: string, prompt: string): { playbook: { id: string; skill: string; title: string } | null } {
	const playbooks = host.playbooks()
	const c = host.caseOf(session)
	const seen = new Set([...(c?.hinted ?? []), ...(host.hintedOf?.(session) ?? [])])
	if (c?.playbook) seen.add(c.playbook.split('@')[0] ?? '')
	const queued = host.takeQueued(session)
	const fromQueue = queued ? playbooks.find(p => p.id === queued && isLive(p) && !seen.has(p.id)) : undefined
	const found = fromQueue ?? suggest({ session, prompt, caseGoalTypes: c?.goals.map(g => g.type).filter(Boolean) ?? [] }, playbooks, seen)
	if (!found) return { playbook: null }
	host.markHinted(session, found.id)
	return { playbook: { id: found.id, skill: `nessy-playbooks:${found.name || found.id}`, title: found.title } }
}
