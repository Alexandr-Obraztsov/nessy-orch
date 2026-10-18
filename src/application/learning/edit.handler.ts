import { fillPrompt, parseEdit } from '../../domain/learning-replies'
import type { PlaybookFiles } from '../../domain/playbook.types'
import type { JobContext, JobHandler } from './handlers.types'
import type { PlaybookState } from './learning.types'
import { applyEdit, editableFiles } from './playbook-edits'

/** Сообщения чата, ждущие правки (`payload.texts` задания `edit`); сводит ждущие задания одного чата. */
export function mergeEditPayload(a: Record<string, unknown> | null, b: Record<string, unknown> | null): Record<string, unknown> {
	const texts = (p: Record<string, unknown> | null): string[] => {
		const t = p?.['texts']
		return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : []
	}
	return { texts: [...texts(a), ...texts(b)] }
}

/** Правки между старым и новым текстом файла: построчно, если число строк то же, иначе одним куском. */
export function diffEdits(oldText: string, newText: string): Array<{ before: string; after: string }> {
	const a = oldText.split('\n')
	const b = newText.split('\n')
	let head = 0
	while (head < a.length && head < b.length && a[head] === b[head]) head++
	let tail = 0
	while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
	const oldMid = a.slice(head, a.length - tail)
	const newMid = b.slice(head, b.length - tail)
	if (!oldMid.length && !newMid.length) return []
	if (oldMid.length === newMid.length) {
		return oldMid.flatMap((line, i) => (line === newMid[i] ? [] : [{ before: line, after: newMid[i] ?? '' }]))
	}
	// чистая вставка или удаление: цитата расширяется соседней строкой, чтобы `before` не был пустым
	if (!oldMid.length || !newMid.length) {
		const prev = a[head - 1]
		const next = a[a.length - tail]
		if (prev !== undefined) return [{ before: [prev, ...oldMid].join('\n'), after: [prev, ...newMid].join('\n') }]
		if (next !== undefined) return [{ before: [...oldMid, next].join('\n'), after: [...newMid, next].join('\n') }]
	}
	return [{ before: oldMid.join('\n'), after: newMid.join('\n') }]
}

/** Строка `rules.md` без счётчиков и ссылок: `- текст (stage N) ▲a ▼b — …` → `текст`. */
const ruleText = (line: string): string => line.replace(/\s*(\(stage \d+\))?\s*▲\d+ ▼\d+.*$/u, '')

/** Разметка строки, которой нет в полях состояния: заголовок, маркер списка, номер. */
const bare = (t: string): string => t.replace(/^(#{1,6}\s+|-\s+|\d+\.\s+)/gm, '')

/** Пробует применить правку как есть, затем без разметки строк. */
function tryApply(p: PlaybookState, file: string, before: string, after: string): PlaybookState | null {
	return applyEdit(p, file, before, after) ?? applyEdit(p, file, bare(before), bare(after))
}

const today = (ctx: JobContext): string => new Date(ctx.now()).toISOString().slice(0, 10)
const appendNote = (old: string, ctx: JobContext, note: string): string => `${old.trim() ? old.replace(/\n*$/, '\n') : ''}- ${today(ctx)}: ${note}\n`

/**
 * Чат: пользователь просит поправить кейс или плейбук. Агент `editor` получает файлы объекта и сообщение.
 * У кейса меняется только `summary.md` (курсор сбора не трогается), у плейбука — поля состояния (как у улучшателя)
 * и выходит новая версия с записью `edit`. Постоянная инструкция уходит в `notes.md` строкой `- <дата>: <note>`.
 */
export const editHandler: JobHandler = {
	kinds: ['edit'],
	async run(ctx) {
		const target = ctx.job.subject.replace(/^edit:/, '')
		const raw = ctx.job.payload?.['texts']
		const texts = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
		if (!texts.length) {
			ctx.finish('нет сообщений')
			return
		}
		const c = target.startsWith('c-') ? ctx.cases.get(target) : null
		const p = target.startsWith('p-') && ctx.playbooks ? ctx.playbooks.get(target) : null
		if (!c && !p) {
			ctx.chat(target, 'Объект не найден: правка невозможна.', [])
			ctx.finish('объект не найден')
			return
		}
		const files: PlaybookFiles = c ? { 'summary.md': ctx.cases.summary(c.id) } : p ? editableFiles(p) : {}
		const notes = c ? ctx.cases.notes(c.id) : (ctx.playbooks?.notes(target) ?? '')
		const object = c ? `case ${c.id}${c.title ? ` — ${c.title}` : ''}; summary.md is the case description` : `playbook ${target} — ${p?.title ?? ''}`
		const prompt = fillPrompt(ctx.prompt('editor'), {
			object,
			files: Object.entries(files)
				.map(([path, text]) => `--- FILE: ${path} ---\n${text}`)
				.join('\n\n'),
			message: texts.join('\n\n'),
			notes: notes.trim() || '(none)',
		})
		const res = await ctx.runAgent(`editor-${target}`, `Правка по чату: ${target}`.slice(0, 80), prompt)
		const edit = parseEdit(res.text)
		if (!edit) throw new Error('в ответе редактора нет корректного <result>')

		const changed: string[] = []
		const skipped: string[] = []
		if (c) {
			const text = edit.files['summary.md']
			if (text !== undefined && text !== files['summary.md']) {
				if (ctx.cases.writeSummary(c.id, text)) changed.push('summary.md')
				else skipped.push('summary.md: не записалось')
			}
			for (const f of Object.keys(edit.files)) if (f !== 'summary.md') skipped.push(`${f}: у кейса правится только summary.md`)
			if (edit.note) ctx.cases.writeNotes(c.id, appendNote(notes, ctx, edit.note))
		} else if (p && ctx.playbooks) {
			let next: PlaybookState = p
			for (const [path, text] of Object.entries(edit.files)) {
				const old = files[path]
				if (old === undefined) {
					skipped.push(`${path}: нового файла плейбука чат не создаёт`)
					continue
				}
				if (old === text) continue
				let ok = true
				// счётчики и ссылки правил агент не меняет: сравниваются только тексты правил
				const [a, b] = path === 'rules.md' ? [old.split('\n').map(ruleText).join('\n'), text.split('\n').map(ruleText).join('\n')] : [old, text]
				if (path === 'rules.md' && a.split('\n').length !== b.split('\n').length) {
					skipped.push('rules.md: правила добавляются и удаляются не через чат')
					continue
				}
				for (const e of diffEdits(a, b)) {
					const applied = tryApply(next, path, e.before, e.after)
					if (applied) next = applied
					else ok = false
				}
				if (ok && next !== p) changed.push(path)
				else skipped.push(`${path}: часть правок не применить к полям плейбука`)
			}
			if (next !== p) {
				ctx.playbooks.saveVersion(next, `Edit via chat: ${edit.summary}`.slice(0, 200), {
					kind: 'edit',
					subject: p.id,
					summary: `${p.id}: правка в чате. ${edit.summary}`,
					report: null,
					revertible: true,
					revertedBy: null,
				})
			}
			if (edit.note) ctx.playbooks.setNotes(p.id, appendNote(notes, ctx, edit.note))
		}
		const extra = skipped.length ? `\n\nНе применено: ${skipped.join('; ')}` : ''
		ctx.chat(target, `${edit.summary}${extra}`, changed)
		ctx.finish(changed.length ? `изменено: ${changed.join(', ')}` : undefined)
	},
}
