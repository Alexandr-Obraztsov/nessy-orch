/**
 * FilePlaybookStore — хранилище плейбуков: git-репозиторий на плейбук.
 *
 *   <home>/playbooks/<id>/playbook.json       PlaybookState (в git)
 *   <home>/playbooks/<id>/files/…             файлы плейбука (в git)
 *   <home>/playbooks/<id>/{notes.md,chat.jsonl,reviews/v<N>.json}   вне git (.gitignore)
 *   <home>/learning/journal.jsonl             журнал
 *   <home>/cases/<id>/chat.jsonl              чат кейса
 *   <pluginDir>                               плагин nessy-playbooks (перезаписывается целиком)
 *   <pluginDir>/../../.<имя>.tmp|.old         временные папки публикации — вне каталога skills, чтобы Claude Code не принял их за плагин
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ChatMessage, JournalEntry, ReviewReport } from '../../../shared/types'
import type { PlaybookStorePort } from '../../application/ports'
import type { PlaybookState } from '../../application/learning/learning.types'
import type { PlaybookFiles } from '../../domain/playbook.types'
import { errMsg, isObject, parseJson } from '../../lib/json'
import { appendJsonl, readJsonl, readTailLines, readText, writeAtomic } from './jsonl'

const PLAYBOOK_ID = /^p-[a-z0-9-]{1,64}$/
const CASE_ID = /^c-[\w.-]{1,200}$/
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
const GIT_ARGS = ['-c', 'user.name=nessy-orch', '-c', 'user.email=nessy-orch@localhost', '-c', 'commit.gpgsign=false']
// якоря со слешем: правила только для корня плейбука (`files/notes.md` остаётся в git)
/** Сколько записей журнала остаётся после обрезки. */
export const JOURNAL_KEEP = 5000
/** Больше стольких записей — журнал обрезается до `JOURNAL_KEEP`. */
export const JOURNAL_MAX = 6000
const GITIGNORE = '/notes.md\n/chat.jsonl\n/reviews/\n'

export class FilePlaybookStore implements PlaybookStorePort {
	readonly playbooksDir: string
	private readonly casesDir: string
	private readonly journalPath: string
	private readonly tmpDir: string
	private readonly oldDir: string
	private lastWarn = 0
	/** число записей в `journal.jsonl` (считается при первой записи) */
	private journalLines = -1

	constructor(
		readonly home: string,
		private readonly pluginDir: string,
	) {
		this.playbooksDir = path.join(home, 'playbooks')
		this.casesDir = path.join(home, 'cases')
		this.journalPath = path.join(home, 'learning', 'journal.jsonl')
		const stage = path.join(path.dirname(path.dirname(pluginDir)), `.${path.basename(pluginDir)}`)
		this.tmpDir = stage + '.tmp'
		this.oldDir = stage + '.old'
		// остатки оборванной публикации
		this.safe('остатки публикации', () => {
			fs.rmSync(this.tmpDir, { recursive: true, force: true })
			fs.rmSync(this.oldDir, { recursive: true, force: true })
		})
	}

	loadPlaybooks(): PlaybookState[] {
		let ids: string[] = []
		try {
			ids = fs.readdirSync(this.playbooksDir)
		} catch {
			return []
		}
		const out: PlaybookState[] = []
		for (const id of ids) {
			const file = path.join(this.playbooksDir, id, 'playbook.json')
			if (!fs.existsSync(file)) continue
			const v = parseJson(readText(file))
			if (isPlaybookState(v)) out.push(v)
			else this.warn(`битый ${file}, плейбук пропущен`)
		}
		return out
	}

	savePlaybook(p: PlaybookState, files: PlaybookFiles, message: string): number {
		const dir = this.dirOf(p.id)
		for (const name of Object.keys(files)) assertRelPath(name)
		fs.mkdirSync(dir, { recursive: true })
		if (!fs.existsSync(path.join(dir, '.git'))) this.git(dir, ['init', '-q'])
		try {
			const ignore = path.join(dir, '.gitignore')
			if (readText(ignore) !== GITIGNORE) fs.writeFileSync(ignore, GITIGNORE)
			writeAtomic(path.join(dir, 'playbook.json'), JSON.stringify(p, null, 2))
			const filesDir = path.join(dir, 'files')
			fs.rmSync(filesDir, { recursive: true, force: true })
			for (const [name, text] of Object.entries(files)) {
				const file = path.join(filesDir, name)
				fs.mkdirSync(path.dirname(file), { recursive: true })
				fs.writeFileSync(file, text)
			}
			this.git(dir, ['add', '-A'])
			if (this.git(dir, ['status', '--porcelain']).trim() !== '' || this.count(dir) === 0) {
				this.git(dir, ['commit', '-q', '--allow-empty', '-m', message || 'update'])
			}
			return this.count(dir)
		} catch (e) {
			// playbook.json на диске не должен расходиться с последним коммитом
			this.rollback(dir)
			throw e
		}
	}

	/** Рабочая копия — к HEAD (игнорируемое: заметки, чат, ревью — не трогается); нет коммитов — убрать записанное. */
	private rollback(dir: string): void {
		this.safe('откат рабочей копии', () => {
			if (this.count(dir) > 0) {
				this.git(dir, ['reset', '-q', '--hard', 'HEAD'])
				this.git(dir, ['clean', '-q', '-fd'])
			} else {
				fs.rmSync(path.join(dir, 'playbook.json'), { force: true })
				fs.rmSync(path.join(dir, 'files'), { recursive: true, force: true })
				fs.rmSync(path.join(dir, '.gitignore'), { force: true })
				this.git(dir, ['rm', '-rq', '--cached', '--ignore-unmatch', '.'])
			}
		})
	}

	saveState(p: PlaybookState): void {
		const dir = this.dirOf(p.id)
		fs.mkdirSync(dir, { recursive: true })
		writeAtomic(path.join(dir, 'playbook.json'), JSON.stringify(p, null, 2))
	}

	readFiles(id: string): PlaybookFiles {
		const filesDir = path.join(this.dirOf(id), 'files')
		const out: PlaybookFiles = {}
		const walk = (rel: string): void => {
			let names: fs.Dirent[] = []
			try {
				names = fs.readdirSync(path.join(filesDir, rel), { withFileTypes: true })
			} catch {
				return
			}
			for (const d of names) {
				const r = rel === '' ? d.name : `${rel}/${d.name}`
				if (d.isDirectory()) walk(r)
				else out[r] = readText(path.join(filesDir, r))
			}
		}
		walk('')
		return out
	}

	versions(id: string): Array<{ version: number; ts: string; message: string }> {
		const dir = this.dirOf(id)
		if (!fs.existsSync(path.join(dir, '.git'))) return []
		try {
			const lines = this.git(dir, ['log', '--reverse', '--format=%cI%x1f%s']).split('\n').filter(Boolean)
			return lines.map((l, i) => {
				const [ts = '', message = ''] = l.split('\x1f')
				return { version: i + 1, ts, message }
			})
		} catch (e) {
			this.warn(`история ${id}: ${errMsg(e)}`)
			return []
		}
	}

	restoreVersion(id: string, version: number): { state: PlaybookState; files: PlaybookFiles } | null {
		const dir = this.dirOf(id)
		if (!fs.existsSync(path.join(dir, '.git'))) return null
		try {
			const shas = this.git(dir, ['log', '--reverse', '--format=%H']).split('\n').filter(Boolean)
			const sha = shas[version - 1]
			if (sha === undefined) return null
			const state = parseJson(this.git(dir, ['show', `${sha}:playbook.json`]))
			if (!isPlaybookState(state)) return null
			const files: PlaybookFiles = {}
			for (const name of this.git(dir, ['ls-tree', '-r', '--name-only', '-z', sha, 'files']).split('\0').filter(Boolean)) {
				files[name.slice('files/'.length)] = this.git(dir, ['show', `${sha}:${name}`])
			}
			return { state, files }
		} catch (e) {
			this.warn(`восстановление ${id}@${version}: ${errMsg(e)}`)
			return null
		}
	}

	removePlaybook(id: string): void {
		this.safe('удаление плейбука', () => fs.rmSync(this.dirOf(id), { recursive: true, force: true }))
	}

	readNotes(id: string): string {
		return readText(path.join(this.dirOf(id), 'notes.md'))
	}

	writeNotes(id: string, text: string): void {
		this.safe('заметки плейбука', () => {
			const dir = this.dirOf(id)
			fs.mkdirSync(dir, { recursive: true })
			writeAtomic(path.join(dir, 'notes.md'), text)
		})
	}

	saveReview(r: ReviewReport): void {
		this.safe('ревью', () => {
			const dir = path.join(this.dirOf(r.playbookId), 'reviews')
			fs.mkdirSync(dir, { recursive: true })
			writeAtomic(path.join(dir, `v${Math.trunc(r.version)}.json`), JSON.stringify(r, null, 2))
		})
	}

	loadReviews(id: string): ReviewReport[] {
		const dir = path.join(this.dirOf(id), 'reviews')
		let names: string[] = []
		try {
			names = fs.readdirSync(dir)
		} catch {
			return []
		}
		const out: ReviewReport[] = []
		for (const n of names) {
			if (!/^v\d+\.json$/.test(n)) continue
			const v = parseJson(readText(path.join(dir, n)))
			if (isObject(v) && typeof v['playbookId'] === 'string' && typeof v['version'] === 'number') out.push(v as unknown as ReviewReport)
		}
		return out.sort((a, b) => a.version - b.version)
	}

	appendJournal(e: JournalEntry): void {
		this.safe('журнал обучения', () => {
			fs.mkdirSync(path.dirname(this.journalPath), { recursive: true })
			if (this.journalLines < 0) this.journalLines = readText(this.journalPath).split('\n').filter(Boolean).length
			appendJsonl(this.journalPath, e)
			this.journalLines += 1
			if (this.journalLines > JOURNAL_MAX) this.trimJournal()
		})
	}

	/** Оставляет последние `JOURNAL_KEEP` записей. */
	private trimJournal(): void {
		const keep = readTailLines(this.journalPath, JOURNAL_KEEP).lines
		writeAtomic(this.journalPath, keep.map(l => l + '\n').join(''))
		this.journalLines = keep.length
	}

	loadJournal(limit: number, before?: string): JournalEntry[] {
		if (limit <= 0) return []
		if (limit >= Number.MAX_SAFE_INTEGER / 2) return readJsonl<JournalEntry>(this.journalPath, limit)
		const parse = (lines: string[]): JournalEntry[] => {
			const out: JournalEntry[] = []
			for (const l of lines) {
				const v = parseJson(l)
				if (isObject(v)) out.push(v as unknown as JournalEntry)
			}
			return out
		}
		if (before === undefined) return parse(readTailLines(this.journalPath, limit).lines)
		// страница старее `before`: хвост растёт, пока запись не найдётся или не кончится файл
		for (let want = limit * 2 + 50; ; want *= 4) {
			const { lines, complete } = readTailLines(this.journalPath, want)
			const all = parse(lines)
			const i = all.findIndex(x => x.id === before)
			if (i >= 0) return all.slice(Math.max(0, i - limit), i)
			if (complete) return []
		}
	}

	updateJournal(e: JournalEntry): void {
		this.safe('журнал обучения', () => {
			const all = readJsonl<JournalEntry>(this.journalPath, Number.MAX_SAFE_INTEGER)
			if (!all.some(x => x.id === e.id)) return
			writeAtomic(this.journalPath, all.map(x => JSON.stringify(x.id === e.id ? e : x) + '\n').join(''))
		})
	}

	appendChat(subject: string, m: ChatMessage): void {
		const file = this.chatPath(subject)
		this.safe('чат', () => {
			fs.mkdirSync(path.dirname(file), { recursive: true })
			appendJsonl(file, m)
		})
	}

	loadChat(subject: string, limit: number): ChatMessage[] {
		return readJsonl<ChatMessage>(this.chatPath(subject), limit)
	}

	publish(active: ReadonlyArray<{ id: string; files: PlaybookFiles }>, version: string): void {
		this.safe('плагин плейбуков', () => {
			const tmp = this.tmpDir
			const old = this.oldDir
			fs.rmSync(tmp, { recursive: true, force: true })
			if (active.length === 0) {
				fs.rmSync(this.pluginDir, { recursive: true, force: true })
				return
			}
			try {
				fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true })
				const meta = { name: 'nessy-playbooks', version, description: 'Playbooks learned by nessy-orch from past sessions' }
				fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), JSON.stringify(meta, null, 2))
				for (const pb of active) {
					assertId(pb.id)
					for (const [name, text] of Object.entries(pb.files)) {
						assertRelPath(name)
						const file = path.join(tmp, 'skills', pb.id, name)
						fs.mkdirSync(path.dirname(file), { recursive: true })
						fs.writeFileSync(file, text, name.startsWith('tools/') ? { mode: 0o755 } : undefined)
						if (name.startsWith('tools/')) fs.chmodSync(file, 0o755)
					}
				}
				fs.rmSync(old, { recursive: true, force: true })
				if (fs.existsSync(this.pluginDir)) fs.renameSync(this.pluginDir, old)
				fs.mkdirSync(path.dirname(this.pluginDir), { recursive: true })
				fs.renameSync(tmp, this.pluginDir)
				fs.rmSync(old, { recursive: true, force: true })
			} catch (e) {
				fs.rmSync(tmp, { recursive: true, force: true })
				// откат: старый плагин возвращается на место
				if (!fs.existsSync(this.pluginDir) && fs.existsSync(old)) fs.renameSync(old, this.pluginDir)
				throw e
			}
		})
	}

	private dirOf(id: string): string {
		assertId(id)
		return path.join(this.playbooksDir, id)
	}

	private chatPath(subject: string): string {
		if (CASE_ID.test(subject)) return path.join(this.casesDir, subject, 'chat.jsonl')
		if (PLAYBOOK_ID.test(subject)) return path.join(this.playbooksDir, subject, 'chat.jsonl')
		throw new Error(`чат: неизвестный объект «${subject}»`)
	}

	private git(cwd: string, args: string[]): string {
		return execFileSync('git', [...GIT_ARGS, ...args], { cwd, stdio: 'pipe', env: GIT_ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
	}

	private count(cwd: string): number {
		try {
			return Number(this.git(cwd, ['rev-list', '--count', 'HEAD']).trim()) || 0
		} catch {
			return 0
		}
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

function assertId(id: string): void {
	if (!PLAYBOOK_ID.test(id)) throw new Error(`недопустимый id плейбука «${id}»`)
}

/** Путь файла плейбука: относительный, без `..` и пустых сегментов. */
function assertRelPath(name: string): void {
	const parts = name.split('/')
	if (name === '' || path.isAbsolute(name) || parts.some(p => p === '' || p === '.' || p === '..')) {
		throw new Error(`недопустимый путь файла плейбука «${name}»`)
	}
}

function isPlaybookState(v: unknown): v is PlaybookState {
	return isObject(v) && typeof v['id'] === 'string' && PLAYBOOK_ID.test(v['id']) && typeof v['status'] === 'string' && Array.isArray(v['rules'])
}
