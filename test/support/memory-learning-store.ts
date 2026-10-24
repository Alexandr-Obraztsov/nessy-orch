/** LearningStorePort в памяти для unit-тестов прикладного слоя. Транскрипты читаются из `files` (путь → текст). */
import type { LearningSettings } from '../../shared/types'
import type { CaseState, JobState, LearningMeta, TranscriptCursor } from '../../src/application/learning/learning.types'
import type { LearningStorePort } from '../../src/application/ports'
import type { RawEvent } from '../../src/domain/learning.types'

export class MemoryLearningStore implements LearningStorePort {
	readonly casesDir = '/memory/cases'
	settingsRaw: unknown = undefined
	mtimeMs = 0
	cases = new Map<string, CaseState>()
	raw = new Map<string, RawEvent[]>()
	summaries = new Map<string, string>()
	notes = new Map<string, string>()
	drafts = new Map<string, string>()
	/** содержимое «файлов» транскриптов по пути */
	files = new Map<string, string>()
	copies = new Map<string, string>()
	jobs: JobState[] = []
	prompts = new Map<string, string>()

	ensured = 0

	ensureCasesDir(): void {
		this.ensured += 1
	}
	loadSettings(): { raw: unknown; mtimeMs: number } {
		return { raw: this.settingsRaw, mtimeMs: this.mtimeMs }
	}
	settingsMtime(): number {
		return this.mtimeMs
	}
	saveSettings(s: LearningSettings): void {
		this.settingsRaw = s
		this.mtimeMs += 1
	}
	loadCases(): CaseState[] {
		return [...this.cases.values()].map(c => structuredClone(c))
	}
	saveCase(c: CaseState): void {
		this.cases.set(c.id, structuredClone(c))
	}
	removeCase(id: string): void {
		this.cases.delete(id)
		this.raw.delete(id)
		this.summaries.delete(id)
	}
	readSummary(id: string): string {
		return this.summaries.get(id) ?? ''
	}
	/** true — запись «не удаётся» (диск полон) */
	failWrites = false
	meta: LearningMeta | null = null
	/** ответы фоновых агентов: `<caseId>/<jobId>` → текст */
	runs = new Map<string, string>()
	writeSummary(id: string, text: string): boolean {
		if (this.failWrites) return false
		this.summaries.set(id, text)
		return true
	}
	readNotes(id: string): string {
		return this.notes.get(id) ?? ''
	}
	writeNotes(id: string, text: string): void {
		this.notes.set(id, text)
	}
	readDraft(id: string): string {
		return this.drafts.get(id) ?? ''
	}
	writeDraft(id: string, text: string): boolean {
		if (this.failWrites) return false
		if (text === '') this.drafts.delete(id)
		else this.drafts.set(id, text)
		return true
	}
	appendRaw(id: string, events: readonly RawEvent[]): boolean {
		if (this.failWrites) return false
		this.raw.set(id, [...(this.raw.get(id) ?? []), ...events])
		return true
	}
	readRaw(id: string, fromN: number, toN?: number): RawEvent[] {
		const byN = new Map<number, RawEvent>()
		for (const e of this.raw.get(id) ?? []) if (e.n >= fromN && (toN === undefined || e.n <= toN)) byN.set(e.n, e)
		return [...byN.values()].sort((a, b) => a.n - b.n)
	}
	truncateRaw(id: string, nextN: number): void {
		this.raw.set(
			id,
			(this.raw.get(id) ?? []).filter(e => e.n < nextN),
		)
	}
	writeRun(subject: string, name: string, text: string): void {
		this.runs.set(`${subject}/${name}`, text)
	}
	readRuns(subject: string, jobId: string): Array<{ name: string; text: string }> {
		const prefix = `${subject}/${jobId}-`
		const found: Array<{ name: string; k: number; text: string }> = []
		for (const [key, text] of this.runs) {
			const m = key.startsWith(prefix) ? /^(\d+)$/.exec(key.slice(prefix.length)) : null
			if (m?.[1] !== undefined) found.push({ name: key.slice(subject.length + 1), k: Number(m[1]), text })
		}
		return found.sort((a, b) => a.k - b.k).map(({ name, text }) => ({ name, text }))
	}
	isAllowedTranscript(file: string, dir: string): boolean {
		return file.startsWith(dir.endsWith('/') ? dir : `${dir}/`)
	}
	loadMeta(): LearningMeta | null {
		return this.meta && structuredClone(this.meta)
	}
	saveMeta(m: LearningMeta): void {
		this.meta = structuredClone(m)
	}
	copyTranscript(id: string, chatId: string, cur: TranscriptCursor): { text: string; next: TranscriptCursor } {
		const full = Buffer.from(this.files.get(cur.path) ?? '', 'utf8')
		const rest = full.subarray(cur.offset)
		const end = rest.lastIndexOf(0x0a)
		if (end < 0) return { text: '', next: cur }
		const chunk = rest.subarray(0, end + 1).toString('utf8')
		const key = `${id}/${chatId}`
		this.copies.set(key, (this.copies.get(key) ?? '') + chunk)
		return { text: chunk, next: { path: cur.path, offset: cur.offset + end + 1 } }
	}
	loadJobs(): JobState[] {
		return this.jobs.map(j => structuredClone(j))
	}
	saveJobs(jobs: readonly JobState[]): void {
		this.jobs = jobs.map(j => structuredClone(j))
	}
	readPrompt(name: string): string {
		return this.prompts.get(name) ?? ''
	}
	/** скрытый архив сырых событий: id кейса → события и время архивации */
	archive = new Map<string, { raw: RawEvent[]; at: number }>()
	archiveRaw(id: string, at: number): void {
		this.archive.set(id, { raw: this.raw.get(id) ?? [], at })
	}
	purgeArchive(before: number): string[] {
		const gone = [...this.archive].filter(([, a]) => a.at <= before).map(([id]) => id)
		for (const id of gone) this.archive.delete(id)
		return gone
	}
}
