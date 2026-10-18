import type { SearchIndex } from './playbook.types'

const STOP_EN = ['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'will', 'have', 'has', 'not', 'but', 'you', 'your', 'all', 'can', 'its', 'into', 'than', 'then', 'there', 'their', 'what', 'when', 'which', 'would', 'should', 'could', 'about', 'also', 'any', 'been', 'just', 'out', 'use']
const STOP_RU = ['что', 'как', 'это', 'для', 'при', 'или', 'так', 'его', 'она', 'они', 'оно', 'все', 'всё', 'вот', 'был', 'была', 'были', 'было', 'быть', 'есть', 'ещё', 'еще', 'если', 'чтобы', 'тоже', 'только', 'уже', 'надо', 'нужно', 'можно', 'мне', 'нас', 'вас', 'них', 'над', 'под', 'про', 'без', 'из', 'где', 'когда', 'тут', 'там', 'ним', 'нам', 'вам', 'наш', 'ваш', 'свой', 'этот', 'эти', 'того', 'этого']
const STOP = new Set([...STOP_EN, ...STOP_RU])

const K1 = 1.2
const B = 0.75
const SHINGLE = 3

/** Слова нижнего регистра: латиница, кириллица, цифры; без стоп-слов и слов короче 3 знаков. */
export function tokenize(text: string): string[] {
	const words = text.toLowerCase().match(/[\p{Script=Latin}\p{Script=Cyrillic}\d]+/gu) ?? []
	return words.filter(w => w.length >= 3 && !STOP.has(w))
}

export function buildIndex(docs: ReadonlyArray<{ id: string; text: string }>): SearchIndex {
	const df = new Map<string, number>()
	const out: SearchIndex['docs'] = []
	let total = 0
	for (const d of docs) {
		const tf = new Map<string, number>()
		const words = tokenize(d.text)
		for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1)
		for (const w of tf.keys()) df.set(w, (df.get(w) ?? 0) + 1)
		out.push({ id: d.id, tf, len: words.length })
		total += words.length
	}
	return { docs: out, df, avgLen: out.length ? total / out.length : 0 }
}

/** BM25 по индексу: документы с ненулевой оценкой, лучшие первыми, не больше `limit`. */
export function search(ix: SearchIndex, query: string, limit: number): Array<{ id: string; score: number }> {
	const n = ix.docs.length
	const terms = [...new Set(tokenize(query))]
	const scored: Array<{ id: string; score: number }> = []
	for (const d of ix.docs) {
		let score = 0
		for (const t of terms) {
			const f = d.tf.get(t)
			if (!f) continue
			const df = ix.df.get(t) ?? 0
			const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
			const norm = ix.avgLen > 0 ? 1 - B + (B * d.len) / ix.avgLen : 1
			score += (idf * f * (K1 + 1)) / (f + K1 * norm)
		}
		if (score > 0) scored.push({ id: d.id, score })
	}
	scored.sort((a, b) => b.score - a.score)
	return scored.slice(0, Math.max(0, limit))
}

function shingles(text: string): Set<string> {
	const words = text.toLowerCase().match(/[\p{Script=Latin}\p{Script=Cyrillic}\d]+/gu) ?? []
	const out = new Set<string>()
	if (words.length < SHINGLE) {
		if (words.length) out.add(words.join(' '))
		return out
	}
	for (let i = 0; i + SHINGLE <= words.length; i++) out.add(words.slice(i, i + SHINGLE).join(' '))
	return out
}

/** Сходство Жаккара по 3-словным шинглам, 0..1. Два пустых текста — 0. */
export function similarity(a: string, b: string): number {
	const sa = shingles(a)
	const sb = shingles(b)
	if (!sa.size || !sb.size) return 0
	let common = 0
	for (const s of sa) if (sb.has(s)) common++
	return common / (sa.size + sb.size - common)
}

/** Разделы, которые читает сопоставитель: заголовок, цели, Actions, Sources. */
const DIGEST_SECTIONS = /^###\s+(actions|sources)\b/i

/** Дайджест сводки кейса: `# ` заголовок, `## Goal:` и строки разделов Actions и Sources (Plan, поправки, вопросы отброшены). */
export function caseDigest(summary: string): string {
	const out: string[] = []
	let keep = false
	for (const raw of summary.split('\n')) {
		const line = raw.trimEnd()
		if (/^#{1,2}\s/.test(line)) {
			keep = false
			out.push(line)
		} else if (/^###\s/.test(line)) {
			keep = DIGEST_SECTIONS.test(line)
			if (keep) out.push(line)
		} else if (keep && line.trim()) {
			out.push(line)
		}
	}
	return out.join('\n')
}
