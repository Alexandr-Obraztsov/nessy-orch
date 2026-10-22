import { createHash } from 'node:crypto'
import type { PlaybookPatch, RuleInput, RuleView } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { renderPlaybook, stagePath } from '../../domain/playbook-render'
import type { PlaybookFiles } from '../../domain/playbook.types'
import type { JobContext } from './handlers.types'
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
	// скрипты и раздел Tools в `SKILL.md` улучшатель не правит: leaves их не содержат
	if (file.startsWith('tools/')) return null
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

/** Плейбук удалили посреди задания (`no_playbook`): задание завершается, плейбук не воскресает. Прочие ошибки идут дальше. */
export async function untilRemoved(ctx: Pick<JobContext, 'finish'>, run: () => Promise<void>): Promise<void> {
	try {
		await run()
	} catch (e) {
		if (!(e instanceof AppError) || e.code !== 'no_playbook') throw e
		ctx.finish('плейбук удалён')
	}
}

type Payload = Record<string, unknown> | null

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/**
 * Сводит `payload` ждущего `review` с новым: хэши правок объединяются, откат идёт к самой ранней версии.
 * Ревью без правок (целиком) сводится с ревью правок в ревью правок, чтобы правки не потерялись.
 */
export function mergeReviewPayload(a: Payload, b: Payload): Payload {
	if (!a) return b
	if (!b) return a
	const bases = [a['baseVersion'], b['baseVersion']].filter((x): x is number => typeof x === 'number' && x > 0)
	return { edits: [...new Set([...strings(a['edits']), ...strings(b['edits'])])], baseVersion: bases.length ? Math.min(...bases) : 0 }
}

/** Id правила по плейбуку и тексту (`r-` + 6 hex sha1); так их ставят улучшатель и правка блоками. */
export const ruleIdOf = (playbookId: string, text: string): string => `r-${createHash('sha1').update(`${playbookId}\n${text}`).digest('hex').slice(0, 6)}`

/**
 * Правка блоками: переданные поля содержания заменяются целиком; ступени нумеруются `n` по порядку массива.
 * Правила: с `id` — замена текста и этапа (счётчики сохраняются), без `id` — новое `candidate` (id — `ruleIdOf`,
 * при совпадении удлиняется); не упомянутые правила не трогаются, `archived` становятся только id из `removeRules`
 * (физически правила не удаляются: счётчики и журнал). Неизвестный или повторный `id` — 400.
 */
export function applyPatch(p: PlaybookState, patch: PlaybookPatch, iso: string): PlaybookState {
	const next: PlaybookState = { ...p }
	if (patch.title !== undefined) next.title = patch.title
	if (patch.description !== undefined) next.description = patch.description
	if (patch.params !== undefined) next.params = patch.params
	if (patch.sources !== undefined) next.sources = patch.sources
	if (patch.files !== undefined) next.files = patch.files
	if (patch.behavior !== undefined) next.behavior = patch.behavior
	if (patch.stages !== undefined) next.stages = patch.stages.map((s, i) => ({ ...s, n: i + 1 }))
	if (patch.rules !== undefined || patch.removeRules !== undefined) {
		const old = new Map(p.rules.map(r => [r.id, r]))
		const used = new Set(old.keys())
		const changed = new Map<string, RuleInput>()
		const fresh: RuleView[] = []
		for (const input of patch.rules ?? []) {
			if (input.id !== undefined) {
				if (!old.has(input.id)) throw new AppError(400, 'bad_request', `в плейбуке ${p.id} нет правила ${input.id}`)
				if (changed.has(input.id)) throw new AppError(400, 'bad_request', `правило ${input.id} указано дважды`)
				changed.set(input.id, input)
				continue
			}
			const full = createHash('sha1').update(`${p.id}\n${input.text}`).digest('hex')
			let len = 6
			while (used.has(`r-${full.slice(0, len)}`) && len < full.length) len++
			const id = `r-${full.slice(0, len)}`
			used.add(id)
			fresh.push({ id, text: input.text, stage: input.stage, status: 'candidate', up: 2, down: 0, evidence: [], against: [], lastAppliedAt: null, createdAt: iso })
		}
		const removed = new Set<string>()
		for (const id of patch.removeRules ?? []) {
			if (!old.has(id)) throw new AppError(400, 'bad_request', `в плейбуке ${p.id} нет правила ${id}`)
			if (changed.has(id)) throw new AppError(400, 'bad_request', `правило ${id} и правится, и удаляется`)
			removed.add(id)
		}
		const kept = p.rules.map((r): RuleView => {
			const input = changed.get(r.id)
			if (input) return { ...r, text: input.text, stage: input.stage }
			return removed.has(r.id) && r.status !== 'archived' ? { ...r, status: 'archived' } : r
		})
		next.rules = [...kept, ...fresh]
	}
	return next
}
