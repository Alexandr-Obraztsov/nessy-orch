/**
 * FileLearningStore — хранилище фонового обучения.
 *
 *   <home>/learning.json                          настройки
 *   <home>/learning/jobs.json                     очередь заданий
 *   <home>/learning/meta.json                     точка отсчёта и надгробия удалённых кейсов
 *   <home>/cases/<id>/state.json                  состояние кейса
 *   <home>/cases/<id>/case.md                     frontmatter + summary.md
 *   <home>/cases/<id>/{summary,notes}.md          описание сессии и заметки
 *   <home>/cases/<id>/raw/events.jsonl            события кейса
 *   <home>/cases/<id>/runs/<job>-<k>.md           ответы фоновых агентов по кейсу
 *   <home>/learning/archive/<id>/raw/             скрытый архив сырых событий свёрнутых сессий (+ `at` — время архивации, мс)
 *   <home>/learning/runs/<subject>/<job>-<k>.md   ответы агентов не-кейсовых заданий
 *   <home>/cases/<id>/raw/transcript-<chat>.jsonl копия транскриптов Claude Code
 *   <root>/learning/prompts/<name>.md             промпты агентов
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { LearningSettings } from '../../../shared/types'
import type { LearningStorePort } from '../../application/ports'
import type { CaseState, FailedBuild, JobState, LearningMeta, TranscriptCursor } from '../../application/learning/learning.types'
import type { RawEvent } from '../../domain/learning.types'
import { arr, errMsg, isObject, parseJson } from '../../lib/json'
import { appendJsonl, readJsonl, readText, writeAtomic } from './jsonl'

const RAW_LIMIT = 1_000_000
/** За один вызов `copyTranscript` читается не больше (остаток — в следующий тик) */
const COPY_LIMIT = 8 * 1024 * 1024

export class FileLearningStore implements LearningStorePort {
	readonly casesDir: string
	private readonly settingsPath: string
	private readonly jobsPath: string
	private readonly metaPath: string
	private readonly promptsDir: string
	private readonly archiveDir: string
	private lastWarn = 0

	constructor(
		readonly home: string,
		root: string,
	) {
		this.casesDir = path.join(home, 'cases')
		this.settingsPath = path.join(home, 'learning.json')
		this.jobsPath = path.join(home, 'learning', 'jobs.json')
		this.metaPath = path.join(home, 'learning', 'meta.json')
		this.promptsDir = path.join(root, 'learning', 'prompts')
		this.archiveDir = path.join(home, 'learning', 'archive')
	}

	ensureCasesDir(): void {
		this.safe('каталог кейсов', () => fs.mkdirSync(this.casesDir, { recursive: true }))
	}

	loadSettings(): { raw: unknown; mtimeMs: number } {
		const mtimeMs = this.settingsMtime()
		if (mtimeMs === 0) return { raw: undefined, mtimeMs }
		return { raw: parseJson(readText(this.settingsPath)), mtimeMs }
	}

	settingsMtime(): number {
		try {
			return fs.statSync(this.settingsPath).mtimeMs
		} catch {
			return 0
		}
	}

	saveSettings(s: LearningSettings): void {
		this.safe('настройки обучения', () => writeAtomic(this.settingsPath, JSON.stringify(s, null, 2)))
	}

	loadCases(): CaseState[] {
		let ids: string[] = []
		try {
			ids = fs.readdirSync(this.casesDir)
		} catch {
			return []
		}
		const out: CaseState[] = []
		for (const id of ids) {
			const file = path.join(this.casesDir, id, 'state.json')
			if (!fs.existsSync(file)) continue
			const v = parseJson(readText(file))
			if (isCaseState(v)) out.push({ ...v, hinted: arr(Reflect.get(v, 'hinted')).filter((x): x is string => typeof x === 'string') })
			else this.warn(`битый ${file}, кейс пропущен`)
		}
		return out
	}

	saveCase(c: CaseState): void {
		this.safe('кейс', () => {
			const dir = this.caseDir(c.id)
			fs.mkdirSync(dir, { recursive: true })
			writeAtomic(path.join(dir, 'state.json'), JSON.stringify(c, null, 2))
			this.writeCaseMd(c)
		})
	}

	removeCase(id: string): void {
		this.safe('удаление кейса', () => fs.rmSync(this.caseDir(id), { recursive: true, force: true }))
	}

	readSummary(id: string): string {
		return readText(path.join(this.caseDir(id), 'summary.md'))
	}

	writeSummary(id: string, text: string): boolean {
		return this.safe('описание кейса', () => {
			const dir = this.caseDir(id)
			fs.mkdirSync(dir, { recursive: true })
			writeAtomic(path.join(dir, 'summary.md'), text)
			const state = parseJson(readText(path.join(dir, 'state.json')))
			if (isCaseState(state)) this.writeCaseMd(state)
		})
	}

	readNotes(id: string): string {
		return readText(path.join(this.caseDir(id), 'notes.md'))
	}

	writeNotes(id: string, text: string): void {
		this.safe('заметки кейса', () => {
			const dir = this.caseDir(id)
			fs.mkdirSync(dir, { recursive: true })
			writeAtomic(path.join(dir, 'notes.md'), text)
		})
	}

	readDraft(id: string): string {
		return readText(path.join(this.caseDir(id), 'draft.md'))
	}

	writeDraft(id: string, text: string): boolean {
		return this.safe('черновик кейса', () => {
			const dir = this.caseDir(id)
			if (text === '') return fs.rmSync(path.join(dir, 'draft.md'), { force: true })
			fs.mkdirSync(dir, { recursive: true })
			writeAtomic(path.join(dir, 'draft.md'), text)
		})
	}

	appendRaw(id: string, events: readonly RawEvent[]): boolean {
		if (events.length === 0) return true
		return this.safe('события кейса', () => {
			const dir = path.join(this.caseDir(id), 'raw')
			fs.mkdirSync(dir, { recursive: true })
			for (const e of events) appendJsonl(path.join(dir, 'events.jsonl'), e)
		})
	}

	readRaw(id: string, fromN: number, toN = Infinity): RawEvent[] {
		// повтор `n` (обрыв сбора посреди записи): последняя запись побеждает, позиция — первой
		const byN = new Map<number, RawEvent>()
		for (const e of readJsonl<RawEvent>(path.join(this.caseDir(id), 'raw', 'events.jsonl'), RAW_LIMIT)) if (e.n >= fromN && e.n <= toN) byN.set(e.n, e)
		return [...byN.values()].sort((a, b) => a.n - b.n)
	}

	/**
	 * Хвост незавершённого сбора (рестарт между записью событий и записью state.json) отрезается.
	 * Копию транскрипта (`raw/transcript-*.jsonl`) не трогаем: это лишь архив, дубль строк допустим.
	 */
	truncateRaw(id: string, nextN: number): void {
		const file = path.join(this.caseDir(id), 'raw', 'events.jsonl')
		const all = readJsonl<RawEvent>(file, RAW_LIMIT)
		const keep = all.filter(e => e.n < nextN)
		if (keep.length === all.length) return
		this.safe('обрезка событий кейса', () => writeAtomic(file, keep.map(e => JSON.stringify(e) + '\n').join('')))
	}

	writeRun(subject: string, name: string, text: string): void {
		this.safe('ответ агента', () => {
			const dir = this.runsDir(subject)
			fs.mkdirSync(dir, { recursive: true })
			writeAtomic(path.join(dir, `${fileName(name)}.md`), text)
		})
	}

	readRuns(subject: string, jobId: string): Array<{ name: string; text: string }> {
		const dir = this.runsDir(subject)
		let names: string[]
		try {
			names = fs.readdirSync(dir)
		} catch {
			return []
		}
		const prefix = `${fileName(jobId)}-`
		const found: Array<{ name: string; k: number }> = []
		for (const f of names) {
			const m = f.startsWith(prefix) ? /^(\d+)\.md$/.exec(f.slice(prefix.length)) : null
			if (m?.[1] !== undefined) found.push({ name: f.slice(0, -'.md'.length), k: Number(m[1]) })
		}
		return found.sort((a, b) => a.k - b.k).map(f => ({ name: f.name, text: readText(path.join(dir, `${f.name}.md`)) }))
	}

	/** Кейсовые ответы лежат в кейсе, остальные — в learning/runs (каталог кейсов без state.json не нужен). */
	private runsDir(subject: string): string {
		return subject.startsWith('c-') ? path.join(this.caseDir(subject), 'runs') : path.join(this.home, 'learning', 'runs', fileName(subject.replace(/:/g, '_')))
	}

	isAllowedTranscript(file: string, dir: string): boolean {
		try {
			const base = fs.realpathSync(path.resolve(dir))
			const real = fs.realpathSync(path.resolve(file))
			return real.startsWith(base.endsWith(path.sep) ? base : base + path.sep) && real.endsWith('.jsonl')
		} catch {
			return false
		}
	}

	loadMeta(): LearningMeta | null {
		const v = parseJson(readText(this.metaPath))
		if (!isObject(v) || typeof v['startedAt'] !== 'number' || typeof v['startSeq'] !== 'number') return null
		const meta: LearningMeta = {
			startedAt: v['startedAt'],
			startSeq: v['startSeq'],
			removed: arr(v['removed']).filter((x): x is string => typeof x === 'string'),
		}
		const failed = arr(v['failedBuilds']).flatMap((f): FailedBuild[] =>
			isObject(f) && typeof f['hash'] === 'string' && typeof f['at'] === 'number'
				? [{ hash: f['hash'], at: f['at'], cases: arr(f['cases']).filter((x): x is string => typeof x === 'string') }]
				: [],
		)
		if (failed.length) meta.failedBuilds = failed
		if (typeof v['lastRecountAt'] === 'number') meta.lastRecountAt = v['lastRecountAt']
		return meta
	}

	saveMeta(m: LearningMeta): void {
		this.safe('метаданные обучения', () => {
			fs.mkdirSync(path.dirname(this.metaPath), { recursive: true })
			writeAtomic(this.metaPath, JSON.stringify(m, null, 2))
		})
	}

	copyTranscript(id: string, chatId: string, cur: TranscriptCursor): { text: string; next: TranscriptCursor } {
		const same = { text: '', next: cur }
		try {
			const size = fs.statSync(cur.path).size
			const offset = size < cur.offset ? 0 : cur.offset // файл стал короче: переписан, читаем сначала
			if (size === offset) return offset === cur.offset ? same : { text: '', next: { path: cur.path, offset } }
			const fd = fs.openSync(cur.path, 'r')
			let buf: Buffer
			try {
				buf = Buffer.alloc(Math.min(size - offset, COPY_LIMIT))
				const n = fs.readSync(fd, buf, 0, buf.length, offset)
				buf = buf.subarray(0, n)
			} finally {
				fs.closeSync(fd)
			}
			const end = buf.lastIndexOf(0x0a)
			if (end < 0) {
				// строка длиннее лимита: пропускаем её начало, иначе чтение застряло бы навсегда
				if (buf.length === COPY_LIMIT && size - offset > COPY_LIMIT) return { text: '', next: { path: cur.path, offset: offset + buf.length } }
				return offset === cur.offset ? same : { text: '', next: { path: cur.path, offset } }
			}
			const chunk = buf.subarray(0, end + 1)
			const next = { path: cur.path, offset: offset + chunk.length }
			const ok = this.safe('копия транскрипта', () => {
				const dir = path.join(this.caseDir(id), 'raw')
				fs.mkdirSync(dir, { recursive: true })
				fs.appendFileSync(path.join(dir, `transcript-${fileName(chatId)}.jsonl`), chunk)
			})
			// не скопировали — курсор не двигаем, повторим в следующий раз
			return ok ? { text: chunk.toString('utf8'), next } : same
		} catch {
			return same
		}
	}

	loadJobs(): JobState[] {
		const raw = parseJson(readText(this.jobsPath))
		const list = isObject(raw) ? arr(raw['jobs']) : arr(raw)
		return list.filter(isJobState).map(j => {
			// миграция этапа 1: нет `subject` — он равен кейсу, нет `payload` — null
			const subject: unknown = Reflect.get(j, 'subject')
			const payload: unknown = Reflect.get(j, 'payload')
			return { ...j, subject: typeof subject === 'string' ? subject : j.caseId, payload: isObject(payload) ? payload : null }
		})
	}

	saveJobs(jobs: readonly JobState[]): void {
		this.safe('очередь обучения', () => {
			fs.mkdirSync(path.dirname(this.jobsPath), { recursive: true })
			writeAtomic(this.jobsPath, JSON.stringify({ jobs }, null, 2))
		})
	}

	readPrompt(name: string): string {
		return readText(path.join(this.promptsDir, `${fileName(name)}.md`))
	}

	archiveRaw(id: string, at: number): void {
		this.safe('архив событий кейса', () => {
			const from = path.join(this.caseDir(id), 'raw')
			if (!fs.existsSync(from)) return
			const dir = path.join(this.archiveDir, fileName(id))
			fs.rmSync(dir, { recursive: true, force: true })
			fs.mkdirSync(dir, { recursive: true })
			fs.renameSync(from, path.join(dir, 'raw'))
			writeAtomic(path.join(dir, 'at'), String(at))
		})
	}

	purgeArchive(before: number): string[] {
		let ids: string[]
		try {
			ids = fs.readdirSync(this.archiveDir)
		} catch {
			return []
		}
		const gone: string[] = []
		for (const id of ids) {
			const dir = path.join(this.archiveDir, id)
			const at = Number(readText(path.join(dir, 'at')))
			// нет отметки времени — смотрим на изменение каталога
			const when = Number.isFinite(at) && at > 0 ? at : fs.statSync(dir).mtimeMs
			if (when > before) continue
			if (this.safe('чистка архива', () => fs.rmSync(dir, { recursive: true, force: true }))) gone.push(id)
		}
		return gone
	}

	private caseDir(id: string): string {
		return path.join(this.casesDir, fileName(id))
	}

	private writeCaseMd(c: CaseState): void {
		const q = (s: string | null): string => (s === null ? 'null' : JSON.stringify(s))
		const head = [
			'---',
			`id: ${c.id}`,
			`title: ${q(c.title)}`,
			`status: ${c.status}`,
			`source: ${c.source}`,
			`sessions: ${JSON.stringify(c.sessions)}`,
			`goals: ${JSON.stringify(c.goals)}`,
			`playbook: ${q(c.playbook)}`,
			`createdAt: ${c.createdAt}`,
			`updatedAt: ${c.updatedAt}`,
			`closedAt: ${c.closedAt ?? 'null'}`,
			'---',
			'',
		].join('\n')
		const summary = this.readSummary(c.id).trim()
		writeAtomic(path.join(this.caseDir(c.id), 'case.md'), head + (summary ? `\n${summary}\n` : ''))
	}

	private warn(msg: string): void {
		const now = Date.now()
		if (now - this.lastWarn > 60_000) {
			this.lastWarn = now
			console.error(`[nessy-orch] ${msg}`)
		}
	}

	/** Сбой записи на диск не роняет оркестратор: предупреждение в stderr не чаще раза в минуту. */
	private safe(what: string, fn: () => void): boolean {
		try {
			fn()
			return true
		} catch (e) {
			this.warn(`не удалось записать (${what}): ${errMsg(e)}`)
			return false
		}
	}
}

/** Имя для файла и каталога: без разделителей путей и точек в начале. */
function fileName(s: string): string {
	return s.replace(/[^\w.-]/g, '_').replace(/^\.+/, '_')
}

function isCaseState(v: unknown): v is CaseState {
	return (
		isObject(v) &&
		typeof v['id'] === 'string' &&
		v['id'] !== '' &&
		Array.isArray(v['sessions']) &&
		typeof v['status'] === 'string' &&
		isObject(v['transcripts'])
	)
}

function isJobState(v: unknown): v is JobState {
	return isObject(v) && typeof v['id'] === 'string' && typeof v['caseId'] === 'string' && typeof v['kind'] === 'string' && typeof v['status'] === 'string'
}
