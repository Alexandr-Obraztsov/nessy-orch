import { renderPlaybook, stagePath } from '../../domain/playbook-render'
import type { PlaybookFiles } from '../../domain/playbook.types'
import type { PlaybookState } from './learning.types'

/** Файлы плейбука для агента: без заметок и журнала версий (их он не правит). */
export function editableFiles(p: PlaybookState): PlaybookFiles {
	const { 'notes.md': _n, 'CHANGELOG.md': _c, ...files } = renderPlaybook(p, '', '')
	return files
}

export const countOf = (text: string, part: string): number => (part === '' ? 0 : text.split(part).length - 1)

/**
 * Применяет правку к полям состояния, из которых рендерится файл: `SKILL.md`, файл этапа, `rules.md`.
 * `before` должен целиком лежать в ровно одном поле; иначе правку применить нельзя (null).
 * Если цитата начинается с маркера списка `- `, он отбрасывается.
 */
export function applyEdit(p: PlaybookState, file: string, before: string, after: string): PlaybookState | null {
	const leaves: Array<{ text: string; put: (v: string) => PlaybookState }> = []
	const stages = (keys: ReadonlyArray<'title' | 'where' | 'produce' | 'done' | 'template'>, only?: number): void => {
		p.stages.forEach((s, i) => {
			if (only !== undefined && only !== i) return
			for (const k of keys) leaves.push({ text: s[k], put: v => ({ ...p, stages: p.stages.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }) })
		})
	}
	if (file === 'SKILL.md') {
		leaves.push({ text: p.title, put: v => ({ ...p, title: v }) }, { text: p.description, put: v => ({ ...p, description: v }) })
		p.params.forEach((x, i) => {
			for (const k of ['name', 'description', 'source'] as const) leaves.push({ text: x[k], put: v => ({ ...p, params: p.params.map((y, j) => (j === i ? { ...y, [k]: v } : y)) }) })
		})
		for (const k of ['sources', 'files', 'behavior'] as const) p[k].forEach((t, i) => leaves.push({ text: t, put: v => ({ ...p, [k]: p[k].map((y, j) => (j === i ? v : y)) }) }))
		stages(['title', 'produce'])
	} else if (file === 'rules.md') {
		p.rules.forEach((r, i) => leaves.push({ text: r.text, put: v => ({ ...p, rules: p.rules.map((x, j) => (j === i ? { ...x, text: v } : x)) }) }))
	} else {
		const at = p.stages.findIndex(s => stagePath(s) === file)
		if (at < 0) return null
		stages(['title', 'where', 'produce', 'done', 'template'], at)
	}
	const bare = (t: string): string => t.replace(/^- /gm, '')
	for (const [b, a] of [[before, after], [bare(before), bare(after)]] as const) {
		const hits = leaves.filter(l => l.text.includes(b))
		const total = hits.reduce((n, l) => n + countOf(l.text, b), 0)
		const hit = hits[0]
		if (total === 1 && hit) return hit.put(hit.text.replace(b, () => a))
	}
	return null
}
