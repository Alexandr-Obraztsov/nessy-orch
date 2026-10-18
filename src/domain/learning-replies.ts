import type { Evidence, PlaybookStage } from '../../shared/types'
import type { BuildDraft, Improvement, JsonObject as Obj, MatchGroup, PlaybookFiles, RuleVerdict } from './playbook.types'

const PLACEHOLDER = /\{\{([A-Za-z_][\w-]*)\}\}/g

/** Подставляет значения в шаблон за один проход: данные не разбираются повторно как плейсхолдеры; неизвестный плейсхолдер — ошибка. */
export function fillPrompt(template: string, vars: Record<string, string>): string {
	return template.replace(PLACEHOLDER, (_m, key: string) => {
		const v = vars[key]
		if (v === undefined) throw new Error(`нет значения для плейсхолдера {{${key}}}`)
		return v
	})
}

/** Имена плейсхолдеров шаблона без повторов. */
export function placeholders(template: string): string[] {
	return [...new Set([...template.matchAll(PLACEHOLDER)].map(m => m[1] ?? ''))]
}

/** JSON из последнего блока `<result>`; нет блока или JSON не разбирается — null (результат `unknown`). Ограда ``` вокруг JSON допускается. */
export function parseResult(text: string): unknown {
	let found: string | null = null
	for (const m of text.matchAll(/<result>([\s\S]*?)<\/result>/g)) found = m[1] ?? ''
	if (found === null) return null
	let raw = found.trim()
	const fence = /^```[a-z]*\s*\n([\s\S]*?)\n?```$/i.exec(raw)
	if (fence) raw = (fence[1] ?? '').trim()
	try {
		return JSON.parse(raw)
	} catch {
		return null
	}
}

function obj(v: unknown): Obj | null {
	return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null
}

function str(v: unknown): string | null {
	return typeof v === 'string' ? v : null
}

function nonEmpty(v: unknown): string | null {
	return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** Массив строк; не массив или есть не строка — null. */
function strings(v: unknown): string[] | null {
	if (!Array.isArray(v)) return null
	const out: string[] = []
	for (const x of v) {
		if (typeof x !== 'string') return null
		out.push(x)
	}
	return out
}

/** Якорь `n 12`, `n 12–15`, `n 12-15` (совпадает с parseAnchor из anchors.ts по форме). */
const ANCHOR = /^n \d+([–-]\d+)?$/

function anchorOf(v: unknown): string | null {
	if (typeof v !== 'string') return null
	const a = v.trim()
	if (!ANCHOR.test(a)) return null
	const nums = a.slice(2).split(/[–-]/).map(Number)
	const [from, to] = [nums[0] ?? 0, nums[1] ?? nums[0] ?? 0]
	return to >= from ? a : null
}

/** Доказательства: элементы с неверным якорем или без кейса отбрасываются; не массив — null. */
function evidenceOf(v: unknown): Evidence[] | null {
	if (!Array.isArray(v)) return null
	const out: Evidence[] = []
	for (const x of v) {
		const o = obj(x)
		const caseId = nonEmpty(o?.caseId)
		const anchor = anchorOf(o?.anchor)
		if (caseId !== null && anchor !== null) out.push({ caseId, anchor })
	}
	return out
}

/** Сопоставитель: группы кейсов одной задачи. Группа без кейсов с верным якорем отбрасывается; нет списка групп — null. */
export function parseMatch(text: string): MatchGroup[] | null {
	const data = parseResult(text)
	const list = Array.isArray(data) ? data : obj(data)?.groups
	if (!Array.isArray(list)) return null
	const groups: MatchGroup[] = []
	for (const g of list) {
		const o = obj(g)
		if (!o) continue
		const task = nonEmpty(o.task)
		if (task === null || !Array.isArray(o.cases)) continue
		const cases: Evidence[] = []
		for (const c of o.cases) {
			const co = obj(c)
			const caseId = nonEmpty(co?.caseId)
			const anchor = anchorOf(co?.anchor)
			if (caseId !== null && anchor !== null && !cases.some(x => x.caseId === caseId && x.anchor === anchor)) cases.push({ caseId, anchor })
		}
		if (cases.length < 1) continue
		const playbookId = nonEmpty(o.playbookId)
		groups.push({ task, taskType: str(o.taskType)?.trim() ?? '', playbookId, cases })
	}
	return groups
}

export function parseCaseAnalysis(text: string): { caseId: string; analysis: string } | null {
	const o = obj(parseResult(text))
	const caseId = nonEmpty(o?.caseId)
	const analysis = nonEmpty(o?.analysis)
	return caseId !== null && analysis !== null ? { caseId, analysis } : null
}

function stageOf(v: unknown): PlaybookStage | null {
	const o = obj(v)
	if (!o) return null
	const slug = nonEmpty(o.slug)
	const title = nonEmpty(o.title)
	if (typeof o.n !== 'number' || !Number.isInteger(o.n) || o.n < 1 || slug === null || title === null) return null
	if (o.role !== null && o.role !== undefined && typeof o.role !== 'string') return null
	const where = str(o.where)
	const produce = str(o.produce)
	const done = str(o.done)
	const template = str(o.template)
	if (where === null || produce === null || done === null || template === null || typeof o.gate !== 'boolean') return null
	const role = typeof o.role === 'string' && o.role.trim() !== '' ? o.role.trim() : null
	return { n: o.n, slug, title, role, where, produce, done, gate: o.gate, template }
}

function listOf<T>(v: unknown, item: (x: unknown) => T | null): T[] | null {
	if (v === undefined) return []
	if (!Array.isArray(v)) return null
	const out: T[] = []
	for (const x of v) {
		const r = item(x)
		if (r === null) return null
		out.push(r)
	}
	return out
}

/** Сборщик плейбука: `BuildDraft`. Нет этапов, нет описания или поле не той формы — null; лишние поля отбрасываются. */
export function parseBuild(text: string): BuildDraft | null {
	const o = obj(parseResult(text))
	if (!o) return null
	const title = nonEmpty(o.title)
	const description = nonEmpty(o.description)
	if (title === null || description === null) return null
	const cases = strings(o.cases ?? [])
	const sources = strings(o.sources ?? [])
	const files = strings(o.files ?? [])
	const behavior = strings(o.behavior ?? [])
	if (cases === null || sources === null || files === null || behavior === null) return null
	if (o.heldOut !== null && o.heldOut !== undefined && typeof o.heldOut !== 'string') return null
	const params = listOf(o.params, p => {
		const po = obj(p)
		const name = nonEmpty(po?.name)
		const d = str(po?.description)
		const source = str(po?.source)
		return name !== null && d !== null && source !== null ? { name, description: d, source } : null
	})
	const stages = listOf(o.stages, stageOf)
	const rules = listOf(o.rules, r => {
		const ro = obj(r)
		const t = nonEmpty(ro?.text)
		const evidence = evidenceOf(ro?.evidence ?? [])
		if (t === null || evidence === null) return null
		if (ro?.stage !== null && ro?.stage !== undefined && typeof ro.stage !== 'number') return null
		return { text: t, stage: typeof ro?.stage === 'number' ? ro.stage : null, evidence }
	})
	if (params === null || stages === null || rules === null || stages.length < 1) return null
	return {
		title,
		description,
		taskType: str(o.taskType)?.trim() ?? '',
		cases,
		heldOut: typeof o.heldOut === 'string' && o.heldOut !== '' ? o.heldOut : null,
		params,
		sources,
		files,
		behavior,
		stages,
		rules,
	}
}

const VERDICTS: ReadonlyArray<RuleVerdict['verdict']> = ['applied', 'violated_by_user_correction', 'not_applicable']

/** Судья: вердикт по правилам; неизвестный вердикт или нет id — null. Неверный якорь становится null. */
export function parseVerdicts(text: string): RuleVerdict[] | null {
	const data = parseResult(text)
	const list = Array.isArray(data) ? data : obj(data)?.verdicts
	if (!Array.isArray(list)) return null
	const out: RuleVerdict[] = []
	for (const v of list) {
		const o = obj(v)
		const ruleId = nonEmpty(o?.ruleId)
		const verdict = VERDICTS.find(x => x === o?.verdict)
		if (ruleId === null || verdict === undefined) return null
		out.push({ ruleId, verdict, anchor: anchorOf(o?.anchor) })
	}
	return out
}

const CAUSES: ReadonlyArray<Improvement['cause']> = ['gap', 'error', 'non_compliance', 'one_off']

/** Улучшатель: причина, правки файлов, кандидаты в правила. Правка без файла или якоря — null всего ответа. */
export function parseImprovement(text: string): Improvement | null {
	const o = obj(parseResult(text))
	const cause = CAUSES.find(x => x === o?.cause)
	if (!o || cause === undefined) return null
	const edits = listOf(o.edits, e => {
		const eo = obj(e)
		const file = nonEmpty(eo?.file)
		const before = str(eo?.before)
		const after = str(eo?.after)
		const anchor = anchorOf(eo?.anchor)
		return file !== null && before !== null && before !== '' && after !== null && anchor !== null ? { file, before, after, anchor } : null
	})
	const candidates = listOf(o.candidates, c => {
		const co = obj(c)
		const t = nonEmpty(co?.text)
		const evidence = evidenceOf(co?.evidence ?? [])
		if (t === null || evidence === null) return null
		if (co?.stage !== null && co?.stage !== undefined && typeof co.stage !== 'number') return null
		return { text: t, stage: typeof co?.stage === 'number' ? co.stage : null, evidence }
	})
	if (edits === null || candidates === null) return null
	return { cause, edits, candidates }
}

/** Редактор: изменённые файлы целиком, заметка для `notes.md` и пояснение для пользователя. */
export function parseEdit(text: string): { files: PlaybookFiles; note: string | null; summary: string } | null {
	const o = obj(parseResult(text))
	const summary = nonEmpty(o?.summary)
	if (!o || summary === null) return null
	const rawFiles = o.files === undefined ? {} : obj(o.files)
	if (rawFiles === null) return null
	const files: PlaybookFiles = {}
	for (const [path, content] of Object.entries(rawFiles)) {
		if (typeof content !== 'string' || path.trim() === '') return null
		files[path] = content
	}
	if (o.note !== null && o.note !== undefined && typeof o.note !== 'string') return null
	return { files, note: nonEmpty(o.note), summary }
}

/** Замечания ревью: `critical` останавливают, `notes` — нет. `critical` обязателен (иначе `{}` сошёл бы за «замечаний нет»), `notes` — нет. */
export function parseGrade(text: string): { critical: string[]; notes: string[] } | null {
	const o = obj(parseResult(text))
	if (!o) return null
	const critical = strings(o.critical)
	const notes = strings(o.notes ?? [])
	return critical !== null && notes !== null ? { critical, notes } : null
}

export const parseReview = parseGrade
export const parseConsistency = parseGrade

export function parsePlan(text: string): { plan: string } | null {
	const plan = nonEmpty(obj(parseResult(text))?.plan)
	return plan !== null ? { plan } : null
}

export function parseComparison(text: string): { winner: 'A' | 'B' | 'tie'; reason: string } | null {
	const o = obj(parseResult(text))
	const w = typeof o?.winner === 'string' ? o.winner.trim().toLowerCase() : ''
	const reason = str(o?.reason)
	if (reason === null) return null
	if (w === 'a') return { winner: 'A', reason }
	if (w === 'b') return { winner: 'B', reason }
	if (w === 'tie') return { winner: 'tie', reason }
	return null
}

export function parseSelection(text: string): { playbookId: string | null } | null {
	const o = obj(parseResult(text))
	if (!o || !('playbookId' in o)) return null
	if (o.playbookId === null) return { playbookId: null }
	const id = nonEmpty(o.playbookId)
	return id !== null ? { playbookId: id } : null
}

export function parseDescription(text: string): { description: string } | null {
	const d = nonEmpty(obj(parseResult(text))?.description)
	return d !== null ? { description: d } : null
}
