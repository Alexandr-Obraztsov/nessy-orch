/**
 * Описание сессии v2: блок `## Brief` (суть, сущности, скелет) и разбор целей.
 * Чистые функции над текстом `summary.md`; формат — `learning/prompts/session-collector.md`.
 */

/** Сколько сущностей допускает `entities`. */
export const BRIEF_ENTITIES_MAX = 12
/** Сколько шагов допускает `skeleton`. */
export const BRIEF_SKELETON_MAX = 6

/** Краткая выжимка описания для сопоставителя. */
export interface Brief {
	gist: string
	entities: string[]
	skeleton: string[]
}

/** Цель описания: название, тип и первая строка `### Plan`. */
export interface GoalHead {
	title: string
	type: string
	plan: string
}

const BRIEF_HEAD = /^##\s+Brief\s*$/i
const GOAL_HEAD = /^##\s+Goal:\s*(.*?)\s*$/
const TOP = /^#{1,2}\s/

/** Строки раздела `## Brief` (до следующего заголовка `#`/`##`); `null` — раздела нет. */
function briefLines(summary: string): string[] | null {
	const rows = summary.split('\n')
	const start = rows.findIndex(l => BRIEF_HEAD.test(l.trim()))
	if (start < 0) return null
	const out: string[] = []
	for (const l of rows.slice(start + 1)) {
		if (TOP.test(l)) break
		out.push(l)
	}
	return out
}

/** Убирает маркер списка и жирный шрифт вокруг ключа: `- **gist:** x` → `gist: x`. */
const clean = (l: string): string => l.trim().replace(/^[-*•]\s+/, '').replace(/\*\*/g, '')

/** Разобранный `## Brief`; `null` — раздела нет или в нём нет всех трёх полей (`gist`, `entities`, `skeleton`). */
export function parseBrief(summary: string): Brief | null {
	const lines = briefLines(summary)
	if (!lines) return null
	let gist = ''
	let entities: string[] = []
	const skeleton: string[] = []
	let inSkeleton = false
	for (const raw of lines) {
		const l = clean(raw)
		if (l === '') continue
		const key = /^(gist|entities|skeleton)\s*:\s*(.*)$/i.exec(l)
		if (key) {
			const name = (key[1] ?? '').toLowerCase()
			const value = (key[2] ?? '').trim()
			inSkeleton = name === 'skeleton'
			if (name === 'gist') gist = value
			else if (name === 'entities') entities = value.split(',').map(s => s.trim()).filter(s => s !== '' && s.toLowerCase() !== 'none')
			else if (value !== '') skeleton.push(value.replace(/^\d+[.)]\s*/, ''))
			continue
		}
		const item = /^\d+[.)]\s*(.*)$/.exec(l)
		if (inSkeleton && item?.[1]) skeleton.push(item[1].trim())
		else if (inSkeleton) skeleton.push(l)
	}
	return gist === '' || !entities.length || !skeleton.length ? null : { gist, entities, skeleton }
}

/** Нарушения `## Brief` для итоговой проверки (F2): пустой список — Brief корректен. */
export function briefProblems(summary: string): string[] {
	if (briefLines(summary) === null) return ['no "## Brief" section']
	const b = parseBrief(summary)
	if (!b) return ['"## Brief" needs all three fields: "gist:", "entities:" and a numbered "skeleton:"']
	const out: string[] = []
	if (b.entities.length > BRIEF_ENTITIES_MAX) out.push(`entities has ${b.entities.length} items (max ${BRIEF_ENTITIES_MAX})`)
	if (b.skeleton.length > BRIEF_SKELETON_MAX) out.push(`skeleton has ${b.skeleton.length} steps (max ${BRIEF_SKELETON_MAX})`)
	return out
}

/** Цели описания по порядку: название, тип (`(type: …)`) и первая строка `### Plan` (без маркера списка). */
export function goalsOf(summary: string): GoalHead[] {
	const out: GoalHead[] = []
	let cur: GoalHead | null = null
	let inPlan = false
	for (const raw of summary.split('\n')) {
		const g = GOAL_HEAD.exec(raw.trim())
		if (g) {
			const m = /^(.*?)\s*\(type:\s*([^)]*)\)\s*$/.exec(g[1] ?? '')
			cur = { title: ((m ? m[1] : g[1]) ?? '').trim(), type: (m?.[2] ?? '').trim(), plan: '' }
			out.push(cur)
			inPlan = false
			continue
		}
		if (/^#{1,2}\s/.test(raw)) {
			cur = null
			inPlan = false
			continue
		}
		const h = /^###\s+(.*)$/.exec(raw)
		if (h) {
			inPlan = (h[1] ?? '').trim().toLowerCase() === 'plan'
			continue
		}
		if (cur && inPlan && cur.plan === '' && raw.trim() !== '') cur.plan = raw.trim().replace(/^[-*•]\s+/, '')
	}
	return out
}

/** Описание без указанных целей (целиком, со всеми их разделами); `# title`, прочие цели и `## Brief` сохраняются. `null` — целей не осталось. */
export function stripGoals(summary: string, goalTitles: readonly string[]): string | null {
	const drop = new Set(goalTitles.map(t => t.trim()))
	const kept: string[] = []
	let skipping = false
	let goals = 0
	for (const raw of summary.split('\n')) {
		const g = GOAL_HEAD.exec(raw.trim())
		if (g) {
			const m = /^(.*?)\s*\(type:\s*([^)]*)\)\s*$/.exec(g[1] ?? '')
			const title = ((m ? m[1] : g[1]) ?? '').trim()
			skipping = drop.has(title)
			if (!skipping) goals++
		} else if (/^#{1,2}\s/.test(raw)) skipping = false
		if (!skipping) kept.push(raw)
	}
	if (!goals) return null
	return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}
