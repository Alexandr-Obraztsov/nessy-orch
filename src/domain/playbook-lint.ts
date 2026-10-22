// Перенос проверок quick_validate.py из anthropics/skills (Apache-2.0): frontmatter, имя, описание, compatibility;
// плюс проверки плейбука: «Use when», размер SKILL.md, доказательства правил, этапы.
import type { PlaybookView } from '../../shared/types'
import { TOOL_MAX_CHARS, TOOL_NAME, TOOLS_MAX } from './learning-replies'
import type { LintIssue, PlaybookFiles } from './playbook.types'

const ALLOWED_KEYS = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility'])
const ANCHOR = /^n \d+(?:[–-]\d+)?$/

/** Верхний уровень frontmatter: `ключ: значение` (вложенные строки пропускаются). */
function parseFrontmatter(text: string): Record<string, string> | null {
	const m = /^---\n([\s\S]*?)\n---/.exec(text)
	if (!m) return null
	const out: Record<string, string> = {}
	for (const line of (m[1] ?? '').split('\n')) {
		const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
		if (!kv) continue
		let v = (kv[2] ?? '').trim()
		if (v.startsWith('"')) {
			try { v = String(JSON.parse(v)) } catch { v = v.replace(/^"|"$/g, '') }
		} else if (v.startsWith('\'') && v.endsWith('\'') && v.length >= 2) {
			v = v.slice(1, -1).replace(/''/g, '\'')
		}
		out[kv[1] ?? ''] = v
	}
	return out
}

/** Описание годится для frontmatter: `Use when…`, ≤ 1024 знаков, без `<` и `>`. null — годится, иначе причина. */
export function validDescription(d: string): string | null {
	const s = d.trim()
	if (!s) return 'Description is empty'
	if (s.length > 1024) return `Description is too long (${s.length} characters, max 1024)`
	if (/[<>]/.test(s)) return 'Description cannot contain angle brackets (< or >)'
	if (!s.startsWith('Use when')) return 'Description must start with "Use when"'
	return null
}

/**
 * Проверка плейбука. `strictEvidence` — новый плейбук: активное правило с < 2 известными кейсами — critical;
 * иначе (плейбук живёт, кейсы могли уйти) — только note.
 */
export function lintPlaybook(p: PlaybookView, files: PlaybookFiles, knownCases: ReadonlySet<string>, opts: { strictEvidence: boolean }): LintIssue[] {
	const issues: LintIssue[] = []
	const critical = (where: string, text: string): void => { issues.push({ level: 'critical', where, text }) }
	const note = (where: string, text: string): void => { issues.push({ level: 'note', where, text }) }

	const skill = files['SKILL.md']
	const extra = Object.keys(files).filter(f => f !== 'SKILL.md' && /(^|\/)SKILL\.md$/.test(f))
	if (extra.length > 0) critical('SKILL.md', `Extra SKILL.md files: ${extra.join(', ')}`)
	if (skill === undefined) {
		critical('SKILL.md', 'SKILL.md not found')
	} else {
		if (skill.split('\n').length > 500) critical('SKILL.md', 'SKILL.md is longer than 500 lines')
		const fm = skill.startsWith('---') ? parseFrontmatter(skill) : null
		if (!fm) {
			critical('SKILL.md', 'No YAML frontmatter found')
		} else {
			const unexpected = Object.keys(fm).filter(k => !ALLOWED_KEYS.has(k))
			if (unexpected.length > 0) critical('SKILL.md', `Unexpected frontmatter keys: ${unexpected.sort().join(', ')}`)
			const name = fm.name?.trim()
			if (!name) {
				critical('SKILL.md name', 'Missing name in frontmatter')
			} else {
				if (!/^[a-z0-9-]+$/.test(name)) critical('SKILL.md name', `Name '${name}' should be kebab-case (lowercase letters, digits, hyphens)`)
				else if (name.startsWith('-') || name.endsWith('-') || name.includes('--')) critical('SKILL.md name', `Name '${name}' cannot start/end with a hyphen or contain consecutive hyphens`)
				if (name.length > 64) critical('SKILL.md name', `Name is too long (${name.length} characters, max 64)`)
			}
			const description = fm.description?.trim()
			if (!description) {
				critical('SKILL.md description', 'Missing description in frontmatter')
			} else {
				const bad = validDescription(description)
				if (bad !== null) critical('SKILL.md description', bad)
			}
			const compat = fm.compatibility
			if (compat && compat.length > 500) critical('SKILL.md compatibility', `Compatibility is too long (${compat.length} characters, max 500)`)
		}
	}

	const tools = p.tools ?? []
	if (tools.length > TOOLS_MAX) critical('tools', `Too many tools (${tools.length}, max ${TOOLS_MAX})`)
	for (const t of tools) {
		const where = `tool ${t.name}`
		if (!TOOL_NAME.test(t.name)) critical(where, `Tool name '${t.name}' is not safe (a-z, 0-9, ., _, -; no paths)`)
		if (t.content.length > TOOL_MAX_CHARS) critical(where, `Tool is longer than ${TOOL_MAX_CHARS} characters`)
		if (skill !== undefined && !skill.includes(`tools/${t.name}`)) critical(where, `SKILL.md does not mention tools/${t.name}`)
	}

	if (p.stages.length === 0) critical('stages', 'The playbook has no stages')
	for (const s of p.stages) {
		if (!s.done.trim()) note(`stage ${s.n}`, 'Stage has no "Done when"')
	}
	for (const x of p.params) {
		if (!x.source.trim()) note(`param ${x.name}`, 'Parameter has no source')
	}

	for (const r of p.rules) {
		const where = `rule ${r.id}`
		const good = new Set<string>()
		for (const e of r.evidence) {
			// кейс мог уйти (удалён, ушёл из хранилища) — это не порча плейбука
			const known = knownCases.has(e.caseId)
			if (!known) note(where, `Evidence refers to unknown case ${e.caseId}`)
			const anchorOk = ANCHOR.test(e.anchor)
			if (!anchorOk) critical(where, `Evidence anchor "${e.anchor}" is not of the form "n a–b"`)
			if (known && anchorOk) good.add(e.caseId)
		}
		if (r.status === 'active' && good.size < 2) {
			const text = 'Active rule needs evidence from at least 2 different existing cases'
			if (opts.strictEvidence) critical(where, text)
			else note(where, text)
		}
	}
	return issues
}
