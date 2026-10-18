/** PlaybookStorePort в памяти для unit-тестов прикладного слоя: версии — массив снимков. */
import type { ChatMessage, JournalEntry, ReviewReport } from '../../shared/types'
import type { PlaybookState } from '../../src/application/learning/learning.types'
import type { PlaybookStorePort } from '../../src/application/ports'
import type { PlaybookFiles } from '../../src/domain/playbook.types'

interface Snapshot {
	state: PlaybookState
	files: PlaybookFiles
	ts: string
	message: string
}

export class MemoryPlaybookStore implements PlaybookStorePort {
	readonly playbooksDir = '/memory/playbooks'
	snapshots = new Map<string, Snapshot[]>()
	notes = new Map<string, string>()
	reviews = new Map<string, ReviewReport[]>()
	journal: JournalEntry[] = []
	chats = new Map<string, ChatMessage[]>()
	/** последний вызов publish */
	published: { active: Array<{ id: string; files: PlaybookFiles }>; version: string } | null = null
	publishCalls = 0
	/** true — savePlaybook бросает (сбой git) */
	failSave = false

	loadPlaybooks(): PlaybookState[] {
		const out: PlaybookState[] = []
		for (const list of this.snapshots.values()) {
			const last = list[list.length - 1]
			if (last) out.push(structuredClone(last.state))
		}
		return out
	}
	savePlaybook(p: PlaybookState, files: PlaybookFiles, message: string): number {
		if (this.failSave) throw new Error('git сломан')
		const list = this.snapshots.get(p.id) ?? []
		const prev = list[list.length - 1]
		const same = prev && JSON.stringify(prev.state) === JSON.stringify(p) && JSON.stringify(prev.files) === JSON.stringify(files)
		if (!same) list.push({ state: structuredClone(p), files: { ...files }, ts: new Date(list.length * 1000).toISOString(), message })
		this.snapshots.set(p.id, list)
		return list.length
	}
	readFiles(id: string): PlaybookFiles {
		const list = this.snapshots.get(id) ?? []
		return { ...(list[list.length - 1]?.files ?? {}) }
	}
	versions(id: string): Array<{ version: number; ts: string; message: string }> {
		return (this.snapshots.get(id) ?? []).map((s, i) => ({ version: i + 1, ts: s.ts, message: s.message }))
	}
	restoreVersion(id: string, version: number): { state: PlaybookState; files: PlaybookFiles } | null {
		const s = this.snapshots.get(id)?.[version - 1]
		return s ? { state: structuredClone(s.state), files: { ...s.files } } : null
	}
	removePlaybook(id: string): void {
		this.snapshots.delete(id)
		this.notes.delete(id)
		this.reviews.delete(id)
		this.chats.delete(id)
	}
	readNotes(id: string): string {
		return this.notes.get(id) ?? ''
	}
	writeNotes(id: string, text: string): void {
		this.notes.set(id, text)
	}
	saveReview(r: ReviewReport): void {
		const list = (this.reviews.get(r.playbookId) ?? []).filter(x => x.version !== r.version)
		list.push(r)
		this.reviews.set(r.playbookId, list.sort((a, b) => a.version - b.version))
	}
	loadReviews(id: string): ReviewReport[] {
		return [...(this.reviews.get(id) ?? [])]
	}
	appendJournal(e: JournalEntry): void {
		this.journal.push({ ...e })
	}
	loadJournal(limit: number): JournalEntry[] {
		return this.journal.slice(-limit).map(e => ({ ...e }))
	}
	updateJournal(e: JournalEntry): void {
		const i = this.journal.findIndex(x => x.id === e.id)
		if (i >= 0) this.journal[i] = { ...e }
	}
	appendChat(subject: string, m: ChatMessage): void {
		const list = this.chats.get(subject) ?? []
		list.push(m)
		this.chats.set(subject, list)
	}
	loadChat(subject: string, limit: number): ChatMessage[] {
		return (this.chats.get(subject) ?? []).slice(-limit)
	}
	publish(active: ReadonlyArray<{ id: string; files: PlaybookFiles }>, version: string): void {
		this.publishCalls += 1
		this.published = { active: active.map(a => ({ id: a.id, files: { ...a.files } })), version }
	}
}
