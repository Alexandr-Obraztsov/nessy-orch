import type { AgentView } from '@contract'
import type { MentionMatch } from '../model/types'

const norm = (s: string): string => s.toLowerCase()

/** «@reviewer текст» → агент reviewer + «текст». Ищет по имени и по id. */
export function parseMention(text: string, agents: AgentView[]): MentionMatch | null {
	const m = /^@(\S+)\s+([\s\S]*)$/.exec(text)
	if (!m) return null
	const key = norm(m[1] ?? '')
	const agent = agents.find(a => norm(a.name) === key || a.id === key)
	return agent ? { agent, rest: m[2] ?? '' } : null
}

/** Набирается «@пре» (ещё без пробела) — варианты дополнения. */
export function mentionQuery(text: string): string | null {
	const m = /^@(\S*)$/.exec(text)
	return m ? norm(m[1] ?? '') : null
}

export function suggest(query: string | null, agents: AgentView[]): AgentView[] {
	if (query === null) return []
	return agents.filter(a => norm(a.name).startsWith(query) || a.id.startsWith(query)).slice(0, 6)
}
