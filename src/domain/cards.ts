/**
 * Карточки для обзора сопоставителя: короткий plain text о кейсе (≤ 500 знаков) и о плейбуке (≤ 600).
 * Кейс — из `## Brief` описания сессии (суть, сущности, скелет); нет Brief — эвристика по целям и первым Actions.
 */
import type { PlaybookView } from '../../shared/types'
import { goalsOf, parseBrief } from './brief'
import type { Brief } from './brief'

export const CASE_CARD_MAX = 500
export const PLAYBOOK_CARD_MAX = 600

/** Строка одной строкой, без лишних пробелов и перевода строк. */
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Обрезка до `max` знаков с многоточием. */
const cut = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`)

/** Поля карточки: подпись, текст и вес при сжатии. */
interface Field {
	label: string
	text: string
	/** доля бюджета при сжатии (чем больше, тем больше места) */
	weight: number
}

/** Собирает строки `label: text`, сжимая поля пропорционально весу, пока всё не уместится в `max`. */
function compose(head: string, fields: readonly Field[], max: number): string {
	const rows = fields.filter(f => f.text !== '')
	const line = (f: Field, limit: number): string => `${f.label}: ${cut(f.text, limit)}`
	const full = [head, ...rows.map(f => line(f, Number.MAX_SAFE_INTEGER))].join('\n')
	if (full.length <= max) return full
	const fixed = head.length + rows.reduce((n, f) => n + f.label.length + 3, 0)
	const room = Math.max(40, max - fixed)
	const weight = rows.reduce((n, f) => n + f.weight, 0) || 1
	// сначала короткие поля отдают всё, что им нужно, остаток делится между длинными
	let left = room
	let w = weight
	const limits = new Map<Field, number>()
	for (const f of [...rows].sort((a, b) => a.text.length / a.weight - b.text.length / b.weight)) {
		const share = Math.floor((left * f.weight) / w)
		const take = Math.min(f.text.length, share)
		limits.set(f, take)
		left -= take
		w -= f.weight
	}
	const out = [head, ...rows.map(f => line(f, limits.get(f) ?? f.text.length))].join('\n')
	return out.length <= max ? out : `${out.slice(0, max - 1).trimEnd()}…`
}

/** Без отметки якоря в конце пункта: `… (n 3–5)`. */
const noAnchor = (s: string): string => s.replace(/\s*\((?:n\s*\d+(?:[–-]\d+)?(?:\s*,\s*)?)+\)\s*$/, '').trim()

/** Первые пункты раздела `### Actions` первой цели: из них эвристика собирает скелет без Brief. */
function firstActions(summary: string, count: number): string[] {
	const out: string[] = []
	let inActions = false
	for (const raw of summary.split('\n')) {
		if (/^#{1,3}\s/.test(raw)) {
			inActions = /^###\s+actions\b/i.test(raw.trim())
			continue
		}
		if (!inActions) continue
		const item = /^[-*•]\s+(.*)$/.exec(raw.trim())
		const text = item?.[1] ? noAnchor(item[1]) : ''
		if (text !== '' && text.toLowerCase() !== 'none') out.push(cut(flat(text.split(' — ')[0] ?? text), 60))
		if (out.length >= count) break
	}
	return out
}

/** Сущности без Brief: тикеты, MR, пути и URL из описания (не больше 8, без повторов). */
function guessEntities(summary: string): string[] {
	const found = summary.match(/\b[A-Z][A-Z0-9]+-\d+\b|\bMR\s*!\d+\b|![0-9]{2,}\b|https?:\/\/\S+|(?:[\w.-]+\/)+[\w.-]+\.\w+/g) ?? []
	return [...new Set(found.map(s => s.replace(/[),.;]+$/, '')))].slice(0, 8)
}

/** Brief описания; нет — эвристика из заголовков, типов целей и первых Actions. */
function briefOf(summary: string, goals: ReadonlyArray<{ title: string; type: string }>): Brief {
	const b = parseBrief(summary)
	if (b) return b
	const skeleton = firstActions(summary, 4)
	return { gist: goals.map(g => g.title).join('; '), entities: guessEntities(summary), skeleton }
}

/** Карточка кейса ≤ 500 знаков: название и дата, цели (тип и первая строка Plan), суть, сущности, скелет. */
export function caseCard(c: { title: string; date: string; summary: string }): string {
	const goals = goalsOf(c.summary)
	const brief = briefOf(c.summary, goals)
	const goalText = goals.map(g => `${g.title}${g.type || g.plan ? ` [${[g.type, g.plan].filter(x => x !== '').join(' — ')}]` : ''}`).join('; ')
	const head = `${cut(flat(c.title) || '(untitled)', 80)} · ${c.date.slice(0, 10)}`
	return compose(
		head,
		[
			{ label: 'goals', text: flat(goalText), weight: 3 },
			{ label: 'gist', text: flat(brief.gist), weight: 3 },
			{ label: 'entities', text: brief.entities.map(flat).join(', '), weight: 2 },
			{ label: 'skeleton', text: brief.skeleton.map((s, i) => `${i + 1}) ${flat(s)}`).join(' '), weight: 3 },
		],
		CASE_CARD_MAX,
	)
}

/** Карточка плейбука ≤ 600 знаков: название, `Use when…`, параметры, этапы, число правил и кейсов, сессии-основания. */
export function playbookCard(p: Pick<PlaybookView, 'title' | 'description' | 'status' | 'params' | 'stages' | 'rules' | 'cases' | 'basedOn'>): string {
	const rules = p.rules.filter(r => r.status !== 'archived').length
	const head = `${cut(flat(p.title), 80)} [${p.status}] · ${rules} rules · ${p.cases.length} cases`
	return compose(
		head,
		[
			{ label: 'use', text: flat(p.description), weight: 4 },
			{ label: 'params', text: p.params.map(x => x.name).join(', '), weight: 1 },
			{ label: 'stages', text: p.stages.map(s => `${s.n}) ${flat(s.title)}`).join(' '), weight: 3 },
			{ label: 'based on sessions', text: (p.basedOn ?? []).map(b => flat(b.session)).join('; '), weight: 2 },
		],
		PLAYBOOK_CARD_MAX,
	)
}
