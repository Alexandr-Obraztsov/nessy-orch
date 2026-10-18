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
 *   <home>/cases/<id>/runs/<job>.md               ответы фоновых агентов
 *   <home>/cases/<id>/raw/transcript-<chat>.jsonl копия транскриптов Claude Code
 *   <root>/learning/prompts/<name>.md             промпты агентов
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { BackfillCandidate, LearningSettings } from '../../../shared/types'
import type { LearningStorePort } from '../../application/ports'
import type { CaseState, JobState, LearningMeta, TranscriptCursor } from '../../application/learning/learning.types'
import type { RawEvent } from '../../domain/learning.types'
import { arr, errMsg, isObject, parseJson } from '../../lib/json'
import { appendJsonl, readJsonl, readText, writeAtomic } from './jsonl'
import { findTranscript, scanTranscripts } from './transcript-scan'

const RAW_LIMIT = 1_000_000
/** За один вызов `copyTranscript` читается не больше (остаток — в следующий тик) */
const COPY_LIMIT = 8 * 1024 * 1024

export class FileLearningStore implements LearningStorePort {
	readonly casesDir: string
	private readonly settingsPath: string
	private readonly jobsPath: string
	private readonly metaPath: string
	private readonly promptsDir: string
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
	}

	ensureCasesDir(): void {
		this.safe('каталог кейсов', () => fs.mkdirSync(this.casesDir, { recursive: true }))
	}

	scanTranscripts(dir: string, known: ReadonlySet<string>): BackfillCandidate[] {
		return scanTranscripts(dir, known)
	}

	findTranscript(dir: string, chatId: string): string | null {
		return findTranscript(dir, chatId)
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

	writeRun(caseId: string, jobId: string, text: string): void {
		this.safe('ответ агента', () => {
			const dir = path.join(this.caseDir(caseId), 'runs')
			fs.mkdirSync(dir, { recursive: true })
			writeAtomic(path.join(dir, `${fileName(jobId)}.md`), text)
		})
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
		return { startedAt: v['startedAt'], startSeq: v['startSeq'], removed: arr(v['removed']).filter((x): x is string => typeof x === 'string') }
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
	return isObject(v) && typeof v['id'] === 'string' && v['id'] !== '' && Array.isArray(v['sessions']) && typeof v['status'] === 'string' && isObject(v['transcripts'])
}

function isJobState(v: unknown): v is JobState {
	return isObject(v) && typeof v['id'] === 'string' && typeof v['caseId'] === 'string' && typeof v['kind'] === 'string' && typeof v['status'] === 'string'
}
