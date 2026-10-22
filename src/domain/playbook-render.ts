import type { PlaybookStage, PlaybookTool, PlaybookView, RuleView } from '../../shared/types'
import type { PlaybookFiles } from './playbook.types'

/** Имя скилла: kebab-case, до 64 знаков; без латиницы и цифр остаётся `playbook`. */
export function skillName(id: string): string {
	const kebab = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '')
	return kebab || 'playbook'
}

const TRANSLIT: Record<string, string> = {
	а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
	х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/** Слаг этапа из названия: кириллица транслитерируется; без латиницы и цифр — `stage-<n>`. */
export function stageSlug(title: string, n: number): string {
	const latin = title.toLowerCase().replace(/[а-яё]/g, ch => TRANSLIT[ch] ?? ch)
	const kebab = latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '')
	return kebab || `stage-${n}`
}

/** Слаги этапов без повторов: второй и следующие с одинаковым слагом получают `-2`, `-3`… */
export function uniqueSlugs<T extends { slug: string }>(stages: readonly T[]): T[] {
	const seen = new Set<string>()
	return stages.map(s => {
		let slug = s.slug
		for (let k = 2; seen.has(slug); k++) slug = `${s.slug}-${k}`
		seen.add(slug)
		return slug === s.slug ? s : { ...s, slug }
	})
}

export function stagePath(s: PlaybookStage): string {
	return `stages/${String(s.n).padStart(2, '0')}-${s.slug}.md`
}

function list(items: string[], empty = '- none'): string {
	return items.length > 0 ? items.map(i => `- ${i}`).join('\n') : empty
}

/** Блок кода с забором длиннее любого забора внутри текста. */
function fence(text: string): string {
	let ticks = 3
	for (const m of text.matchAll(/`{3,}/g)) ticks = Math.max(ticks, m[0].length + 1)
	const f = '`'.repeat(ticks)
	return `${f}\n${text}\n${f}`
}

/** Раздел «Tools» в `SKILL.md`: пусто, если инструментов нет. */
function renderTools(tools: PlaybookTool[]): string[] {
	if (tools.length === 0) return []
	const items = tools.map(t => `- \`${t.name}\` — ${t.description || 'no description'}. Run: \`bash tools/${t.name}\` (path relative to this skill folder)`)
	return ['## Tools', ...items, '']
}

function renderSkill(p: PlaybookView): string {
	const params = p.params.map(x => `- \`{${x.name}}\` — ${x.description}. Source: ${x.source || 'unknown'}`)
	const steps = p.stages.map(s => `${s.n}. [${s.title}](${stagePath(s)}) — ${s.produce}${s.gate ? ' (show the user before continuing)' : ''}`)
	return [
		'---',
		`name: ${skillName(p.name || p.id)}`,
		`description: ${JSON.stringify(p.description)}`,
		'---',
		'',
		`# ${p.title}`,
		'',
		'## Parameters',
		list(params),
		'',
		'## Sources',
		list(p.sources),
		'',
		'## Key files',
		list(p.files),
		'',
		'## Steps',
		steps.length > 0 ? steps.join('\n') : '- none',
		'',
		'## Behavior',
		list(p.behavior),
		'',
		'## Rules',
		'See [rules.md](rules.md).',
		'',
		...renderTools(p.tools ?? []),
		'## Notes',
		'User notes: [notes.md](notes.md).',
		'',
	].join('\n')
}

function renderStage(s: PlaybookStage): string {
	const out = [
		`# Stage ${s.n}: ${s.title}`,
		'',
		`Role: ${s.role ?? 'any'}`,
		'',
		'## Where to look',
		s.where,
		'',
		'## Produce',
		s.produce,
		'',
		'## Done when',
		s.done,
		'',
	]
	if (s.gate) out.push('## Show the user before continuing', 'Present the result of this stage to the user and wait for approval.', '')
	out.push('## Assignment template', fence(s.template), '')
	return out.join('\n')
}

function renderRules(rules: RuleView[]): string {
	const active = rules.filter(r => r.status === 'active')
	const lines = active.map(r => {
		const stage = r.stage === null ? 'all stages' : `stage ${r.stage}`
		const refs = r.evidence.map(e => `${e.caseId} ${e.anchor}`).join('; ')
		return `- ${r.text} (${stage}) ▲${r.up} ▼${r.down}${refs ? ` — ${refs}` : ''}`
	})
	return ['# Rules', '', ...(lines.length > 0 ? lines : ['No active rules yet.']), ''].join('\n')
}

/** Файлы плейбука-скилла: `SKILL.md`, этапы, правила, `tools/*`, заметки, журнал версий. */
export function renderPlaybook(p: PlaybookView, notes: string, changelog: string): PlaybookFiles {
	const files: PlaybookFiles = {
		'SKILL.md': renderSkill(p),
		'rules.md': renderRules(p.rules),
		'notes.md': notes || '# Notes\n',
		'CHANGELOG.md': changelog || '# Changelog\n',
	}
	for (const s of p.stages) files[stagePath(s)] = renderStage(s)
	for (const t of p.tools ?? []) files[`tools/${t.name}`] = t.content
	return files
}

/** Дописывает запись версии сверху журнала (под заголовком). */
export function addChangelog(prev: string, version: number, date: string, lines: string[]): string {
	const entry = `## v${version} — ${date}\n${lines.map(l => `- ${l}`).join('\n')}\n`
	const text = prev.trim()
	if (!text) return `# Changelog\n\n${entry}`
	const nl = text.indexOf('\n')
	if (!text.startsWith('#') || nl < 0) return `${text.startsWith('#') ? text : '# Changelog'}\n\n${entry}`
	return `${text.slice(0, nl)}\n\n${entry}\n${text.slice(nl + 1).replace(/^\n+/, '')}\n`
}
