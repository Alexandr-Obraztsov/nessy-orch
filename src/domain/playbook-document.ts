// Плейбук как один markdown-документ: смотреть, править, сохранять. Парсер собирает структуру обратно.
import type { PlaybookParam, PlaybookStage, PlaybookTool, PlaybookView, RuleView } from '../../shared/types'
import { skillName, stageSlug, uniqueSlugs } from './playbook-render'
import type { ParsedDocument, ParseResult } from './playbook.types'

const ANY = 'any'
const MARKER = /\s*<!--\s*(r[0-9A-Za-z_-]*)(?:\s+stage:(\d+|all))?\s*-->\s*$/
const ONLY_COMMENT = /^<!--.*-->$/

/** Блок кода с забором длиннее любого забора внутри текста. */
function fence(text: string): string {
	let ticks = 3
	for (const m of text.matchAll(/`{3,}/g)) ticks = Math.max(ticks, m[0].length + 1)
	const f = '`'.repeat(ticks)
	return `${f}\n${text}\n${f}`
}

/** Элемент списка: продолжение многострочного текста сдвигается на два пробела. */
const item = (text: string): string => `- ${text.replace(/\n/g, '\n  ')}`
const list = (items: string[]): string[] => (items.length > 0 ? items.map(item) : ['- none'])
const toolLine = (t: PlaybookTool): string => `- \`${t.name}\` — ${t.description || 'no description'}. Run: \`bash tools/${t.name}\``

function ruleLine(r: RuleView): string {
	const marker = `<!-- ${r.id}${r.stage === null ? '' : ` stage:${r.stage}`} -->`
	return `${item(r.text)} ${marker}`
}

/** Канонический документ плейбука. Архивные правила не показываются. */
export function renderDocument(p: PlaybookView, notes: string): string {
	const active = p.rules.filter(r => r.status === 'active')
	const candidates = p.rules.filter(r => r.status === 'candidate')
	const out: string[] = [
		'---',
		`name: ${skillName(p.name || p.id)}`,
		`description: ${JSON.stringify(p.description)}`,
		`title: ${JSON.stringify(p.title)}`,
		`taskType: ${JSON.stringify(p.taskType)}`,
		'---',
		'',
		'## Parameters',
		...(p.params.length > 0 ? p.params.map(x => `- \`{${x.name}}\` — ${x.description} — source: ${x.source}`.replace(/ $/, '')) : ['- none']),
		'',
		'## Sources',
		...list(p.sources),
		'',
		'## Key files',
		...list(p.files),
		'',
		'## Steps',
	]
	if (p.stages.length === 0) out.push('- none')
	for (const s of p.stages) {
		out.push(
			'',
			`### ${s.n}. ${s.title}`,
			`- role: ${s.role ?? ANY}`,
			`- where: ${s.where.replace(/\n/g, '\n  ')}`,
			`- produces: ${s.produce.replace(/\n/g, '\n  ')}`,
			`- done when: ${s.done.replace(/\n/g, '\n  ')}`,
			`- gate: ${s.gate ? 'yes' : 'no'}`,
			'',
			fence(s.template),
		)
	}
	out.push('', '## Rules', ...active.map(ruleLine), '', '### Candidates', ...candidates.map(ruleLine), '', '## Behavior', ...list(p.behavior), '')
	out.push('## Tools', ...((p.tools ?? []).length > 0 ? (p.tools ?? []).map(toolLine) : ['- none']), '')
	out.push('## Based on', ...((p.basedOn ?? []).length > 0 ? (p.basedOn ?? []).map(b => `- ${b.session} — ${b.date}`) : ['- none']), '')
	out.push('## Notes', notes.trim(), '')
	return out.join('\n')
}

interface Section {
	name: string
	lines: string[]
}

/** Открывает ли строка забор кода: число обратных кавычек или 0. */
const fenceOpen = (line: string): number => /^(`{3,})/.exec(line)?.[1]?.length ?? 0

/** Делит текст на разделы `## Имя`; заголовки внутри кодовых заборов не считаются. */
function sections(lines: string[]): { head: string[]; list: Section[] } {
	const head: string[] = []
	const out: Section[] = []
	let open = 0
	for (const line of lines) {
		const f = fenceOpen(line)
		if (open === 0 && f > 0) open = f
		else if (open > 0 && f >= open && line.trim() === '`'.repeat(f)) open = 0
		const h = open === 0 ? /^## (.+?)\s*$/.exec(line) : null
		if (h) out.push({ name: h[1] ?? '', lines: [] })
		else (out.at(-1)?.lines ?? head).push(line)
	}
	return { head, list: out }
}

const trimBlank = (lines: string[]): string[] => {
	let a = 0
	let b = lines.length
	while (a < b && (lines[a] ?? '').trim() === '') a++
	while (b > a && (lines[b - 1] ?? '').trim() === '') b--
	return lines.slice(a, b)
}

/** Элементы списка: `- текст`, продолжение — строки с отступом; нескрытые строки без `- ` тоже элементы. */
function items(lines: string[]): string[] {
	const out: string[] = []
	let cur: string[] | null = null
	const flush = (): void => {
		if (cur) out.push(cur.join('\n').trim())
		cur = null
	}
	for (const line of lines) {
		if (line.trim() === '') continue
		const m = /^[-*] (.*)$/.exec(line)
		if (m) {
			flush()
			cur = [m[1] ?? '']
		} else if (cur && /^\s/.test(line)) {
			cur.push(line.replace(/^ {1,2}/, ''))
		} else {
			flush()
			cur = [line]
		}
	}
	flush()
	return out.filter(t => t !== '')
}

const plain = (lines: string[]): string[] => items(lines).filter(t => t !== 'none')

function frontmatter(lines: string[]): { fm: Record<string, string> | null; rest: string[] } {
	if (lines[0]?.trim() !== '---') return { fm: null, rest: lines }
	const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
	if (end < 0) return { fm: null, rest: lines }
	const fm: Record<string, string> = {}
	for (const line of lines.slice(1, end)) {
		if (line.trim() === '') continue
		const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
		if (!kv) return { fm: null, rest: lines }
		let v = (kv[2] ?? '').trim()
		if (v.startsWith('"')) {
			try {
				v = String(JSON.parse(v))
			} catch {
				v = v.replace(/^"|"$/g, '')
			}
		}
		fm[kv[1] ?? ''] = v
	}
	return { fm, rest: lines.slice(end + 1) }
}

function parseParams(lines: string[], issues: string[]): PlaybookParam[] {
	const out: PlaybookParam[] = []
	for (const t of plain(lines)) {
		const m = /^`\{([^}]*)\}`\s+—\s*([\s\S]*)$/.exec(t)
		if (!m) {
			issues.push(`Parameters: строка не распознана: ${t}`)
			continue
		}
		const body = m[2] ?? ''
		const at = body.lastIndexOf('— source:')
		const description = (at < 0 ? body : body.slice(0, at)).trim()
		const source = at < 0 ? '' : body.slice(at + '— source:'.length).trim()
		out.push({ name: m[1] ?? '', description, source })
	}
	return out
}

function parseStages(lines: string[], prev: PlaybookView, issues: string[]): PlaybookStage[] {
	const blocks: Array<{ title: string; lines: string[] }> = []
	let open = 0
	for (const line of lines) {
		const f = fenceOpen(line)
		if (open === 0 && f > 0) open = f
		else if (open > 0 && f >= open && line.trim() === '`'.repeat(f)) open = 0
		const h = open === 0 ? /^### \d+\.\s*(.*?)\s*$/.exec(line) : null
		if (h) blocks.push({ title: h[1] ?? '', lines: [] })
		else blocks.at(-1)?.lines.push(line)
	}
	const stages = blocks.map((b, i): PlaybookStage => {
		const n = i + 1
		const fields: Record<string, string[]> = {}
		let cur: string[] | null = null
		let template = ''
		let k = 0
		for (; k < b.lines.length; k++) {
			const line = b.lines[k] ?? ''
			const f = fenceOpen(line)
			if (f > 0) {
				const body: string[] = []
				k++
				while (k < b.lines.length && !((b.lines[k] ?? '').trim() === '`'.repeat(f))) body.push(b.lines[k++] ?? '')
				template = body.join('\n')
				break
			}
			const m = /^- (role|where|produces|done when|gate):\s?(.*)$/i.exec(line)
			if (m) {
				cur = [m[2] ?? '']
				fields[(m[1] ?? '').toLowerCase()] = cur
			} else cur?.push(line.replace(/^ {1,2}/, ''))
		}
		const get = (key: string): string => (fields[key] ?? []).join('\n').trim()
		const role = get('role')
		const slug = prev.stages.find(s => s.title === b.title)?.slug ?? stageSlug(b.title, n)
		if (b.title.trim() === '') issues.push(`Steps: у этапа ${n} нет названия`)
		return {
			n,
			slug,
			title: b.title,
			role: role === '' || role.toLowerCase() === ANY ? null : role,
			where: get('where'),
			produce: get('produces'),
			done: get('done when'),
			gate: /^(yes|true|да)$/i.test(get('gate')),
			template,
		}
	})
	return uniqueSlugs(stages)
}

function parseRules(sec: Section[], prev: PlaybookView, issues: string[]): Pick<ParsedDocument, 'rules' | 'added' | 'archived'> {
	const byId = new Map(prev.rules.map(r => [r.id, r]))
	const seen = new Set<string>()
	const edited = new Map<string, RuleView>()
	const added: ParsedDocument['added'] = []
	const lines: Array<{ status: 'active' | 'candidate'; text: string }> = []
	for (const s of sec) {
		const status = s.name.toLowerCase() === 'candidates' ? 'candidate' : 'active'
		for (const t of items(s.lines)) lines.push({ status, text: t })
	}
	for (const { status, text } of lines) {
		if (ONLY_COMMENT.test(text) && !MARKER.test(text)) continue
		const m = MARKER.exec(text)
		const body = (m ? text.slice(0, m.index) : text).trim()
		const id = m?.[1]
		const known = id !== undefined ? byId.get(id) : undefined
		if (known && !seen.has(known.id)) {
			seen.add(known.id)
			if (body === '') continue
			const st = m?.[2]
			const stage = st === undefined || st === 'all' ? null : Number(st)
			edited.set(known.id, { ...known, text: body, stage, status })
		} else if (body !== '') {
			added.push({ text: body, stage: m?.[2] && m[2] !== 'all' ? Number(m[2]) : null, status })
		} else issues.push('Rules: пустая строка правила')
	}
	const archived: string[] = []
	const rules = prev.rules.map((r): RuleView => {
		if (r.status === 'archived') return edited.get(r.id) ?? r
		const e = edited.get(r.id)
		if (e) return e
		archived.push(r.id)
		return { ...r, status: 'archived' }
	})
	return { rules, added, archived }
}

/** Обратная сборка структуры из документа; `issues` — ошибки (документ не применяется). */
export function parseDocument(text: string, prev: PlaybookView): ParseResult {
	const issues: string[] = []
	const notices: string[] = []
	const all = text.replace(/\r\n?/g, '\n').split('\n')
	const { fm, rest } = frontmatter(all)
	if (!fm) issues.push('Frontmatter: нет или повреждён (ожидается блок --- name/description/title/taskType ---)')
	const description = (fm?.['description'] ?? '').trim()
	if (fm && description === '') issues.push('Frontmatter: нет description')
	const { list: secs } = sections(rest)
	const find = (name: string): Section | undefined => secs.find(s => s.name.toLowerCase() === name.toLowerCase())
	const known = new Set(['parameters', 'sources', 'key files', 'steps', 'rules', 'candidates', 'behavior', 'tools', 'based on', 'notes'])

	const steps = find('Steps')
	const stages = parseStages(steps?.lines ?? [], prev, issues)
	if (stages.length === 0) issues.push('Steps: нет этапов (### 1. Название)')

	// `### Candidates` — подраздел `## Rules`: заголовок `###` внутри раздела делит строки
	const rulesSec = find('Rules')
	const ruleSections: Section[] = [{ name: 'Rules', lines: [] }]
	let open = 0
	for (const line of rulesSec?.lines ?? []) {
		const f = fenceOpen(line)
		if (open === 0 && f > 0) open = f
		else if (open > 0 && f >= open && line.trim() === '`'.repeat(f)) open = 0
		const h = open === 0 ? /^### (.+?)\s*$/.exec(line) : null
		if (h) ruleSections.push({ name: h[1] ?? '', lines: [] })
		else ruleSections.at(-1)?.lines.push(line)
	}
	const rules = parseRules(ruleSections, prev, issues)

	const toolLines = plain(find('Tools')?.lines ?? [])
	const same = toolLines.length === (prev.tools ?? []).length && (prev.tools ?? []).every(t => toolLines.includes(toolLine(t).slice(2)))
	if (!same) notices.push('Tools: инструменты в документе только для чтения, изменения проигнорированы')

	const extras = secs.filter(s => !known.has(s.name.toLowerCase()))
	const noteParts = [trimBlank(find('Notes')?.lines ?? []).join('\n'), ...extras.map(s => `## ${s.name}\n${trimBlank(s.lines).join('\n')}`.trimEnd())]
	const draft: ParsedDocument = {
		title: (fm?.['title'] ?? prev.title).trim(),
		description,
		taskType: (fm?.['taskType'] ?? prev.taskType).trim(),
		params: parseParams(find('Parameters')?.lines ?? [], issues),
		sources: plain(find('Sources')?.lines ?? []),
		files: plain(find('Key files')?.lines ?? []),
		behavior: plain(find('Behavior')?.lines ?? []),
		stages,
		...rules,
		notes: noteParts.filter(x => x !== '').join('\n\n'),
	}
	return { draft, issues, notices }
}
