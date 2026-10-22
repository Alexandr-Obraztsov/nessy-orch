/**
 * Строгие проверки описания сессии при сдаче блока (`nessy-orch case draft`): чистые функции без LLM.
 * Каждая проверка возвращает все свои нарушения сразу; отказ перечисляет их все (`formatRejection`).
 */
import { parseAnchor } from './anchors'
import { eventText } from './case-events'
import type { GateInput, GateIssue, RawEvent } from './learning.types'

/** Минимум слов в причине строки `### Skipped`. */
const MIN_REASON_WORDS = 3
/** Сколько событий блока приходится на один якорный пункт (R4). */
const EVENTS_PER_ITEM = 6
/** Длина совпадения с текстом блока, с которой это копирование (R8). */
const COPY_CHARS = 200
/** Длина цитаты поправки пользователя, слов (R7). */
const QUOTE_WORDS = 25
/** Доля якорей прежнего описания, которая обязана уцелеть в итоговом (F1). */
const KEEP_RATIO = 0.9
/** Сколько элементов перечисляется в тексте отказа. */
const LIST_MAX = 8

const SECTIONS = ['Plan', 'Actions', 'Sources', 'User corrections', 'Open questions', 'Skipped'] as const

const ANCHOR = /(?<![\p{L}\d])n\s?(\d+)(?:\s*[–—-]\s*(\d+))?/gu
const GOAL = /^##\s+Goal:\s*(.*?)\s*$/
const GOAL_FULL = /^##\s+Goal:\s*\S.*\(type:\s*\S[^)]*\)\s*$/
const WATER = [
	/\b(the|this) (text|session|conversation|dialogue|dialog|discussion|events?) (discusses|describes|talks about|is about|covers|deals with)\b/i,
	/(в|на) (этом )?(тексте|сессии|разговоре|диалоге|блоке)\s+(обсуждается|рассказывается|говорится|описывается|идёт речь|идет речь)/i,
	/(текст|сессия|разговор|диалог|блок) (посвящ[её]н|рассказывает|описывает|обсуждает)/i,
]
// только сильные маркеры поправки: слабые («should», «нет», «надо», «лучше») требовали бы цитат там, где поправки нет
const CORRECTION = [/(?:\bno[,.!\s]|\bdon't\b|\bdo not\b|\binstead\b|\bwrong\b|\bactually\b)/i, /(?:не так|неправильн|исправь|вместо этого|а не )/i]
const EXTENSIONS = 'ts|tsx|js|jsx|mjs|cjs|json|md|swift|py|yml|yaml|sh|txt|css|html|go|rs|java|kt|c|h|cpp|toml|sql|xml|rb|lock|plist|conf|env|log|csv|php|vue|svelte|gradle'

/** Якорь описания (`n 12–15`): границы и признак корректной записи. */
export interface FoundAnchor {
	raw: string
	from: number
	to: number
	ok: boolean
}

/** Все якоря строки (текста); `ok=false` — нарушен порядок границ. */
export function findAnchors(text: string): FoundAnchor[] {
	const out: FoundAnchor[] = []
	for (const m of text.matchAll(ANCHOR)) {
		const raw = m[0]
		const range = parseAnchor(raw)
		out.push(range ? { raw, from: range.from, to: range.to, ok: true } : { raw, from: Number(m[1]), to: Number(m[2] ?? m[1]), ok: false })
	}
	return out
}

/** Разобранное описание: цели с разделами и строки без заголовков. */
interface Parsed {
	/** строки раздела `### Skipped` всех целей */
	skipped: string[]
	/** строки содержательных разделов (не заголовки, не `### Skipped`) */
	body: string[]
	/** строки `### User corrections` всех целей */
	corrections: string[]
}

interface GoalBlock {
	title: string
	/** раздел → непустые строки (нет ключа — раздела нет) */
	sections: Map<string, string[]>
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()

function sectionKey(heading: string): string {
	return norm(heading).toLowerCase()
}

function parse(text: string): { parsed: Parsed; goals: GoalBlock[]; titleOk: boolean } {
	const parsed: Parsed = { skipped: [], body: [], corrections: [] }
	const goals: GoalBlock[] = []
	let goal: GoalBlock | null = null
	let section: string | null = null
	let first = true
	let titleOk = false
	for (const raw of text.split('\n')) {
		const line = raw.trimEnd()
		if (first && line.trim() !== '') {
			titleOk = /^#\s+\S/.test(line)
			first = false
			continue
		}
		const g = GOAL.exec(line)
		if (g) {
			goal = { title: g[1] ?? '', sections: new Map() }
			goals.push(goal)
			section = null
			parsed.body.push(line)
			continue
		}
		const h = /^###\s+(.*)$/.exec(line)
		if (h) {
			section = sectionKey(h[1] ?? '')
			if (goal && !goal.sections.has(section)) goal.sections.set(section, [])
			continue
		}
		if (/^#{1,2}\s/.test(line)) {
			// другой заголовок верхнего уровня: раздел кончился
			section = null
			if (/^##\s/.test(line)) goal = null
			continue
		}
		if (line.trim() === '') continue
		if (goal && section !== null) goal.sections.get(section)?.push(line)
		if (section === 'skipped') parsed.skipped.push(line)
		else {
			parsed.body.push(line)
			if (section === 'user corrections') parsed.corrections.push(line)
		}
	}
	return { parsed, goals, titleOk }
}

/** Диапазоны номеров через запятую: `12–14, 20`. */
function rangesText(ns: readonly number[]): string {
	const sorted = [...new Set(ns)].sort((a, b) => a - b)
	const parts: string[] = []
	let i = 0
	while (i < sorted.length) {
		let j = i
		while (j + 1 < sorted.length && (sorted[j + 1] ?? 0) === (sorted[j] ?? 0) + 1) j++
		parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`)
		i = j + 1
	}
	return `n ${parts.join(', ')}`
}

const cap = (items: readonly string[]): string => (items.length > LIST_MAX ? `${items.slice(0, LIST_MAX).join(', ')}, … (${items.length} in all)` : items.join(', '))

/** Причина пропуска: текст строки без якорей, тире и маркера списка. */
function reasonOf(line: string): string {
	return norm(line.replace(ANCHOR, ' ').replace(/^[\s\-*•]+/, '').replace(/^[–—:\s]+/, ''))
}

const words = (s: string): number => (s.trim() === '' ? 0 : s.trim().split(/\s+/).length)

/** R1: каждый якорь корректен и лежит в `[1, until]`. */
function r1(text: string, until: number): GateIssue[] {
	const bad = findAnchors(text).filter(a => !a.ok || a.from < 1 || a.to > until).map(a => (a.ok ? `${a.raw} (outside n 1–${until})` : `${a.raw} (malformed range)`))
	return bad.length ? [{ code: 'R1', text: `anchors: ${cap([...new Set(bad)])}; every anchor must lie within n 1–${until}` }] : []
}

/** Номера событий, закрытых строкой `### Skipped` с причиной; и строки с короткой причиной. */
function skippedSet(skipped: readonly string[]): { skip: Set<number>; short: string[] } {
	const skip = new Set<number>()
	const short: string[] = []
	for (const line of skipped) {
		const anchors = findAnchors(line).filter(a => a.ok)
		if (!anchors.length) continue
		if (words(reasonOf(line)) < MIN_REASON_WORDS) short.push(anchors.map(a => a.raw).join(', '))
		else for (const a of anchors) for (let n = a.from; n <= a.to; n++) skip.add(n)
	}
	return { skip, short }
}

/** R2: каждое событие блока цитируется якорем либо пропущено с причиной. */
function uncovered(parsed: Parsed, events: readonly RawEvent[]): { missing: number[]; short: string[] } {
	const { skip, short } = skippedSet(parsed.skipped)
	const covered = new Set<number>(skip)
	for (const line of parsed.body) for (const a of findAnchors(line)) if (a.ok) for (let n = a.from; n <= a.to; n++) covered.add(n)
	return { missing: events.map(e => e.n).filter(n => !covered.has(n)), short }
}

function r2(parsed: Parsed, events: readonly RawEvent[]): GateIssue[] {
	const { missing, short } = uncovered(parsed, events)
	const out: GateIssue[] = []
	if (missing.length) out.push({ code: 'R2', text: `coverage: events ${rangesText(missing)} are neither cited as an anchor nor listed under ### Skipped with a reason of at least ${MIN_REASON_WORDS} words` })
	if (short.length) out.push({ code: 'R2', text: `coverage: ### Skipped reason too short (need ${MIN_REASON_WORDS}+ words) for ${cap(short)}` })
	return out
}

/** R3: описание изменилось и в нём есть якорь внутри блока. */
function r3(input: GateInput): GateIssue[] {
	if (input.text.trim() === input.prev.trim()) return [{ code: 'R3', text: 'progress: the description is identical to the previous accepted one' }]
	const inside = findAnchors(input.text).some(a => a.ok && a.to >= input.from && a.from <= input.until)
	return inside ? [] : [{ code: 'R3', text: `progress: no anchor inside the current block (n ${input.from}–${input.until})` }]
}

/** R4: якорных пунктов блока не меньше ⌈событий/6⌉ (события из `### Skipped` не считаются). */
function r4(parsed: Parsed, input: GateInput): GateIssue[] {
	const { skip } = skippedSet(parsed.skipped)
	const left = input.events.filter(e => !skip.has(e.n)).length
	const need = Math.ceil(left / EVENTS_PER_ITEM)
	const have = parsed.body.filter(l => !GOAL.test(l) && findAnchors(l).some(a => a.ok && a.to >= input.from && a.from <= input.until)).length
	return have < need ? [{ code: 'R4', text: `density: ${have} anchored items for the events of n ${input.from}–${input.until}, need at least ${need} (one per ${EVENTS_PER_ITEM} events)` }] : []
}

/** R5: общие фразы вместо фактов. */
function r5(text: string): GateIssue[] {
	const hits: string[] = []
	for (const line of text.split('\n')) {
		for (const re of WATER) {
			const m = re.exec(line)
			if (m) hits.push(`"${m[0]}"`)
		}
	}
	return hits.length ? [{ code: 'R5', text: `filler: ${cap(hits)}; state facts (who did what, result, anchor) instead of describing the text` }] : []
}

/** Идентификаторы блока, которые описание обязано сохранить: ключи тикетов, MR, URL, пути, числа ≥ 3 цифр. */
export function blockFacts(events: readonly RawEvent[]): string[] {
	const found: string[] = []
	for (const e of events) {
		let t = eventText(e)
		const take = (re: RegExp, map: (s: string) => string = s => s): void => {
			for (const m of t.matchAll(re)) found.push(map(m[0]))
			t = t.replace(re, ' ')
		}
		take(/https?:\/\/[^\s)>\]"'`]+/g, s => s.replace(/[.,;:]+$/, ''))
		take(/\bMR\s*!\d+/g, s => s.replace(/^MR\s*/, ''))
		take(/(?<![\w!])![0-9]{2,}\b/g)
		take(/\b[A-Z][A-Z0-9]+-\d+\b/g)
		take(new RegExp(`(?<![\\w./:@-])(?:[\\w.-]+/)+[\\w.-]*\\w\\.[A-Za-z][A-Za-z0-9]{0,4}\\b|(?<![\\w./:@-])[\\w-]+\\.(?:${EXTENSIONS})\\b`, 'g'))
		t = t.replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
		take(/(?<![\w.!-])\d{3,}(?!\w)/g)
	}
	return [...new Set(found)]
}

/** R6: идентификаторы блока встречаются в описании. */
function r6(text: string, events: readonly RawEvent[]): GateIssue[] {
	const plain = text.replace(ANCHOR, ' ')
	const missing = blockFacts(events).filter(f => {
		if (/^\d+$/.test(f)) return !plain.includes(f)
		if (text.includes(f)) return false
		// путь: достаточно имени файла
		const base = f.includes('/') && !/^https?:/.test(f) ? f.slice(f.lastIndexOf('/') + 1) : ''
		return !(base !== '' && text.includes(base))
	})
	return missing.length ? [{ code: 'R6', text: `facts: identifiers of the block are missing from the description: ${cap(missing)}; put each into an item or into ### Skipped` }] : []
}

/** События `user`, где есть маркер поправки или указания. */
export function correctionEvents(events: readonly RawEvent[]): RawEvent[] {
	return events.filter(e => e.kind === 'user' && CORRECTION.some(re => re.test(e.text)))
}

/** R7: поправки пользователя процитированы в `### User corrections` с якорем на их `n`. */
function r7(parsed: Parsed, events: readonly RawEvent[]): GateIssue[] {
	const missing: number[] = []
	const long: number[] = []
	for (const e of correctionEvents(events)) {
		const lines = parsed.corrections.filter(l => findAnchors(l).some(a => a.ok && a.from <= e.n && e.n <= a.to))
		if (!lines.length) {
			missing.push(e.n)
			continue
		}
		const quotes = lines.flatMap(l => [...l.matchAll(/"([^"]*)"|«([^»]*)»/g)].map(m => m[1] ?? m[2] ?? ''))
		if (quotes.length && quotes.every(q => words(q) > QUOTE_WORDS)) long.push(e.n)
	}
	const out: GateIssue[] = []
	if (missing.length) out.push({ code: 'R7', text: `corrections: user events ${rangesText(missing)} contain a correction or instruction; quote each under ### User corrections with an anchor on its n` })
	if (long.length) out.push({ code: 'R7', text: `corrections: the quote for ${rangesText(long)} is longer than ${QUOTE_WORDS} words; shorten it` })
	return out
}

/** R8: нет строки с подстрокой текста блока от 200 знаков. */
function r8(text: string, events: readonly RawEvent[]): GateIssue[] {
	const block = norm(events.map(e => eventText(e)).join(' '))
	const bad: string[] = []
	for (const line of text.split('\n')) {
		const l = norm(line)
		if (l.length < COPY_CHARS) continue
		for (let i = 0; i + COPY_CHARS <= l.length; i++) {
			if (block.includes(l.slice(i, i + COPY_CHARS))) {
				bad.push(`"${l.slice(0, 40)}…"`)
				break
			}
		}
	}
	return bad.length ? [{ code: 'R8', text: `copying: ${cap(bad)} repeats ${COPY_CHARS}+ characters of the block verbatim; retell in your own words` }] : []
}

/** R9: структура описания. */
function r9(text: string): GateIssue[] {
	const { goals, titleOk } = parse(text)
	const problems: string[] = []
	if (!titleOk) problems.push('the first line must be "# <session title>"')
	const heads = text.split('\n').filter(l => GOAL.test(l))
	if (!heads.length) problems.push('no "## Goal: <title> (type: <type>)" section')
	for (const h of heads) if (!GOAL_FULL.test(h)) problems.push(`goal line "${h.trim().slice(0, 60)}" has no "(type: …)"`)
	for (const g of goals) {
		const lacking: string[] = []
		for (const s of SECTIONS) {
			const lines = g.sections.get(sectionKey(s))
			if (lines === undefined) lacking.push(`missing ### ${s}`)
			else if (!lines.length) lacking.push(`empty ### ${s} (write "- none")`)
		}
		if (lacking.length) problems.push(`goal "${g.title.slice(0, 40)}": ${lacking.join('; ')}`)
	}
	return problems.length ? [{ code: 'R9', text: `structure: ${problems.join('; ')}` }] : []
}

/** Проверка описания, сданного за блок: R1–R9, все нарушения сразу. */
export function checkBlock(input: GateInput): GateIssue[] {
	const { parsed } = parse(input.text)
	return [...r1(input.text, input.until), ...r2(parsed, input.events), ...r3(input), ...r4(parsed, input), ...r5(input.text), ...r6(input.text, input.events), ...r7(parsed, input.events), ...r8(input.text, input.events), ...r9(input.text)]
}

/** Якоря описания как уникальные ключи `a-b`. */
function anchorKeys(text: string): Map<string, string> {
	const m = new Map<string, string>()
	for (const a of findAnchors(text)) if (a.ok) m.set(`${a.from}-${a.to}`, a.raw)
	return m
}

/** Итоговая консолидация (`--final`): R1, R5, R9 и сохранение якорей прежнего описания (≥ 90 %). */
export function checkFinal(input: { text: string; prev: string; until: number }): GateIssue[] {
	const issues = [...r1(input.text, input.until), ...r5(input.text), ...r9(input.text)]
	const before = anchorKeys(input.prev)
	if (before.size) {
		const now = anchorKeys(input.text)
		const lost = [...before].filter(([k]) => !now.has(k)).map(([, raw]) => raw)
		const kept = before.size - lost.length
		if (kept / before.size < KEEP_RATIO) issues.push({ code: 'F1', text: `anchors preserved: only ${kept} of ${before.size} anchors of the previous description remain (need ${Math.round(KEEP_RATIO * 100)}%); missing e.g. ${cap(lost)}; merging duplicate items is fine, dropping facts is not` })
	}
	return issues
}

/** Текст отказа агенту: все нарушения и что делать. */
export function formatRejection(issues: readonly GateIssue[], attempt: number, max: number): string {
	return `REJECTED (attempt ${attempt}/${max}): ${issues.map(i => `${i.code}: ${i.text}`).join(' | ')}. Fix only the listed items. Do not resubmit until all checks pass.`
}

/** Правила, которые на первой ступени лестницы смягчения становятся предупреждениями. */
const SOFT = new Set(['R4', 'R6', 'R7'])
/** Правила, которые остаются жёсткими на последней ступени (структура и якоря не выдуманы). */
const CORE = new Set(['R1', 'R3', 'R9'])

/** Нарушения по ступени лестницы: `fails` = сколько заданий подряд исчерпали отказы на этом блоке (0 — всё жёстко, 1 — R4/R6/R7 предупреждения, ≥ 2 — жёсткие только R1/R3/R9). */
export function applyLadder(issues: readonly GateIssue[], fails: number): { hard: GateIssue[]; warnings: GateIssue[] } {
	const waived = (i: GateIssue): boolean => (fails >= 2 ? !CORE.has(i.code) : fails === 1 ? SOFT.has(i.code) : false)
	return { hard: issues.filter(i => !waived(i)), warnings: issues.filter(waived) }
}

const sectionName = (line: string): string => sectionKey(line.replace(/^###\s+/, ''))

/** Дописывает строки в конец раздела `### <name>` (последней цели; нет раздела — в конец текста), убирая заглушку `- none`. */
export function appendToSection(text: string, name: string, lines: readonly string[]): string {
	const rows = text.split('\n')
	let start = -1
	rows.forEach((l, i) => {
		if (/^###\s+/.test(l) && sectionName(l) === sectionKey(name)) start = i
	})
	if (start < 0) return [...rows, `### ${name}`, ...lines].join('\n')
	let end = start + 1
	while (end < rows.length && !/^#{1,3}\s/.test(rows[end] ?? '')) end++
	const kept = rows.slice(start + 1, end).filter(l => l.trim() !== '' && l.trim() !== '- none')
	return [...rows.slice(0, start + 1), ...kept, ...lines, ...rows.slice(end)].join('\n')
}

/** События блока, не закрытые якорем и не пропущенные с причиной, как диапазоны `[a, b]`. */
function ranges(ns: readonly number[]): Array<[number, number]> {
	const out: Array<[number, number]> = []
	for (const n of [...ns].sort((a, b) => a - b)) {
		const last = out[out.length - 1]
		if (last && last[1] + 1 === n) last[1] = n
		else out.push([n, n])
	}
	return out
}

/** Последняя ступень: непокрытые события сервер сам записывает в `### Skipped` (след в описании остаётся). */
export function waiveSkipped(text: string, events: readonly RawEvent[]): string {
	const { missing } = uncovered(parse(text).parsed, events)
	if (!missing.length) return text
	return appendToSection(text, 'Skipped', ranges(missing).map(([a, b]) => `- n ${a}${b > a ? `–${b}` : ''} — not summarized (gate waived after repeated rejections)`))
}

/** Минимальное описание блока от сервера: прежнее принятое (или заготовка) плюс пункты `### Actions` по заголовкам событий, помеченные `(auto)`. */
export function autoDescription(prev: string, events: readonly RawEvent[]): string {
	const first = prev.split('\n').find(l => l.trim() !== '') ?? ''
	const base = prev.trim() !== '' && r9(prev).length === 0 ? prev : [/^#\s+\S/.test(first) ? first : '# session', '## Goal: (auto) work of the session (type: unknown task)', ...SECTIONS.flatMap(s => [`### ${s}`, '- none'])].join('\n')
	// «n 5» внутри цитаты не должно читаться как якорь
	const plain = (t: string): string => t.replace(/(?<![\p{L}\d])n(\s?\d)/gu, 'n.$1').replace(/\s+/g, ' ')
	return appendToSection(
		base,
		'Actions',
		events.map(e => `- (auto) [${e.n}] ${e.kind} ${plain(e.to ? `${e.from}→${e.to}` : e.from)}: ${plain(eventText(e)).slice(0, 80)} (n ${e.n})`),
	)
}
