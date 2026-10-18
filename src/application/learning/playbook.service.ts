import type { JournalEntry, PendingEdit, PlaybookDetail, PlaybookStatus, PlaybookView, ReviewReport, RuleStatus, RuleView } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { uniqueName } from '../../domain/naming'
import { addChangelog, renderPlaybook, skillName } from '../../domain/playbook-render'
import type { BuildDraft, MatchGroup } from '../../domain/playbook.types'
import type { Hub } from '../hub'
import type { Clock, IdGenerator, PlaybookStorePort } from '../ports'
import type { PlaybookState } from './learning.types'
import { applyEdit } from './playbook-edits'

export interface PlaybookServiceDeps {
	store: PlaybookStorePort
	hub: Hub
	clock: Clock
	ids: IdGenerator
	/** версия плагина nessy-playbooks при публикации; по умолчанию `1.0.<счётчик публикаций>` */
	pluginVersion?: () => string
	/** кейс по id (нужен только `playbook` кейса) */
	caseOf?: (id: string) => { playbook: string | null } | null
}

type NewEntry = Omit<JournalEntry, 'id' | 'ts'>

const LIVE: readonly PlaybookStatus[] = ['trial', 'active']
const isLive = (s: PlaybookStatus): boolean => LIVE.includes(s)
const STATUSES: readonly PlaybookStatus[] = ['draft', 'review', 'trial', 'active', 'disabled', 'archived']
const RULE_STATUSES: readonly RuleStatus[] = ['candidate', 'active', 'archived']

/** Видимая часть плейбука (без вердиктов и служебных счётчиков). */
export function playbookView(p: PlaybookState): PlaybookView {
	const { verdicts: _v, rejectedEdits: _r, reviewAttempts: _a, ...view } = p
	return view
}

/**
 * Откат содержания: из старой версии берутся поля содержания (название, описание, тип, параметры, источники, файлы,
 * поведение, ступени, тексты и набор правил), рабочие поля (статус, пробный режим, кейсы, вердикты, счётчики и статусы
 * правил, присутствующих в обеих версиях, отклонённые и ждущие правки) остаются текущими.
 */
export function restoreContent(current: PlaybookState, old: PlaybookState): PlaybookState {
	const now = new Map(current.rules.map(r => [r.id, r]))
	const rules = old.rules.map(r => {
		const c = now.get(r.id)
		return c ? { ...r, status: c.status, up: c.up, down: c.down, evidence: c.evidence, against: c.against, lastAppliedAt: c.lastAppliedAt } : r
	})
	return { ...current, title: old.title, description: old.description, taskType: old.taskType, params: old.params, sources: old.sources, files: old.files, behavior: old.behavior, stages: old.stages, rules }
}

/** Разбор `report` записи журнала; не JSON — пустой объект. */
function parseReport(report: string | null): Record<string, unknown> {
	if (!report) return {}
	try {
		const v: unknown = JSON.parse(report)
		return typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : {}
	} catch {
		return {}
	}
}

/**
 * Состояние плейбуков: версии (git в хранилище), правила, публикация активных в плагин и журнал решений.
 * Журнал и события `learning_playbook*`/`learning_journal` публикует он.
 *
 * Откат (`revert`) читает из `report` записи журнала JSON одной из форм:
 * `{prevStatus}` — статус плейбука, `{ruleId, prevStatus}` — статус правила, `{version}` — версия (откат к `version − 1` новой версией).
 */
export class PlaybookService {
	private readonly map = new Map<string, PlaybookState>()
	private publishCount = 0

	constructor(private readonly deps: PlaybookServiceDeps) {}

	load(): void {
		this.map.clear()
		for (const p of this.deps.store.loadPlaybooks()) this.map.set(p.id, { ...p, pendingEdits: p.pendingEdits ?? [] })
		// плагин должен совпадать с диском и после рестарта
		try {
			this.publishActive()
		} catch {
			// публикация повторится при следующей смене живых плейбуков
		}
	}

	list(): PlaybookState[] {
		return [...this.map.values()]
	}

	get(id: string): PlaybookState | null {
		return this.map.get(id) ?? null
	}

	/** Плейбук или 404 `no_playbook`. */
	need(id: string): PlaybookState {
		const p = this.map.get(id)
		if (!p) throw new AppError(404, 'no_playbook', `плейбук ${id} не найден`)
		return p
	}

	detail(id: string): PlaybookDetail {
		const p = this.need(id)
		const { store } = this.deps
		return { ...playbookView(p), notes: store.readNotes(id), changelog: store.readFiles(id)['CHANGELOG.md'] ?? '', versions: store.versions(id), reviews: store.loadReviews(id) }
	}

	/** Последние записи журнала, старые первыми. */
	journal(limit = 200): JournalEntry[] {
		return this.deps.store.loadJournal(limit)
	}

	/** Плейбук кейса по `case.playbook` вида `<id>@<версия>`. */
	forCase(caseId: string): PlaybookState | null {
		const ref = this.deps.caseOf?.(caseId)?.playbook
		if (!ref) return null
		return this.get(ref.split('@')[0] ?? '')
	}

	/** Новый плейбук `draft`: правила с доказательствами из ≥ 2 кейсов — `active`, иначе `candidate`. */
	create(draft: BuildDraft, group: MatchGroup, heldOut: string | null): PlaybookState {
		const iso = this.iso()
		const base = `p-${skillName(draft.taskType || group.taskType || draft.title).slice(0, 56)}`
		const id = uniqueName(base, n => this.map.has(n))
		const rules: RuleView[] = draft.rules.map(r => ({
			id: `r-${this.deps.ids.next(6)}`,
			text: r.text,
			stage: r.stage,
			status: new Set(r.evidence.map(e => e.caseId)).size >= 2 ? 'active' : 'candidate',
			up: 2,
			down: 0,
			evidence: r.evidence,
			against: [],
			lastAppliedAt: null,
			createdAt: iso,
		}))
		const fallback = [...new Set(group.cases.map(e => e.caseId))]
		const p: PlaybookState = {
			id,
			// имя скилла = id: ingest ищет `nessy-playbooks:<id>`
			name: id,
			title: draft.title,
			description: draft.description,
			taskType: draft.taskType || group.taskType,
			status: 'draft',
			version: 0,
			cases: draft.cases.length ? draft.cases : fallback,
			heldOut,
			params: draft.params,
			sources: draft.sources,
			files: draft.files,
			behavior: draft.behavior,
			stages: draft.stages,
			rules,
			trial: null,
			createdAt: iso,
			updatedAt: iso,
			verdicts: {},
			rejectedEdits: [],
			reviewAttempts: 0,
			pendingEdits: [],
		}
		return this.persist(p, 'Playbook created', { kind: 'playbook_created', subject: id, summary: `Создан плейбук «${draft.title}»`, report: null, revertible: false, revertedBy: null })
	}

	/** Рендер → `savePlaybook` (ошибка git бросается, состояние не меняется) → `learning_playbook`; необязательная запись журнала. */
	saveVersion(p: PlaybookState, message: string, journal?: NewEntry): PlaybookState {
		// удалённый плейбук не воскресает
		this.need(p.id)
		return this.persist(p, message, journal)
	}

	private persist(p: PlaybookState, message: string, journal?: NewEntry): PlaybookState {
		const saved = this.commit(p, message)
		if (journal) {
			const wantsVersion = journal.kind === 'version' || journal.kind === 'edit'
			this.record(wantsVersion && journal.report === null ? { ...journal, report: JSON.stringify({ version: saved.version }) } : journal)
		}
		return saved
	}

	/** Смена статуса: версия с причиной, запись журнала (в `report` — прежний статус для отката), публикация. */
	setStatus(id: string, status: PlaybookStatus, reason: string, kind?: JournalEntry['kind']): PlaybookState {
		const p = this.need(id)
		if (p.status === status) return p
		const saved = this.commit({ ...p, status }, reason)
		this.record({
			kind: kind ?? (isLive(status) ? 'published' : 'edit'),
			subject: id,
			summary: `${id}: ${p.status} → ${status}. ${reason}`,
			report: JSON.stringify({ prevStatus: p.status }),
			revertible: true,
			revertedBy: null,
		})
		return saved
	}

	/** Добавляет кейсы в `cases` без новой версии: пишется только `playbook.json` (следующая версия закоммитит). */
	addCases(id: string, caseIds: readonly string[]): PlaybookState {
		const p = this.need(id)
		const added = [...new Set(caseIds)].filter(c => !p.cases.includes(c))
		if (!added.length) return p
		const next: PlaybookState = { ...p, cases: [...p.cases, ...added], updatedAt: this.iso() }
		this.deps.store.saveState(next)
		this.map.set(id, next)
		this.deps.hub.publish({ t: 'learning_playbook', playbook: playbookView(next) })
		return next
	}

	/** Правки улучшателя, ждущие решения человека (`autoReview: false`): без новой версии, пишется только `playbook.json`. */
	setPendingEdits(id: string, edits: readonly PendingEdit[]): PlaybookState {
		const p = this.need(id)
		const next: PlaybookState = { ...p, pendingEdits: [...edits], updatedAt: this.iso() }
		this.deps.store.saveState(next)
		this.map.set(id, next)
		this.deps.hub.publish({ t: 'learning_playbook', playbook: playbookView(next) })
		return next
	}

	/** Принять ждущую правку: применяется к текущему состоянию → новая версия и запись `edit`. Не применить — 409 `stale_edit`, правка снимается. */
	acceptEdit(id: string, hash: string): PlaybookState {
		const p = this.need(id)
		const pending = p.pendingEdits ?? []
		const e = pending.find(x => x.hash === hash)
		if (!e) throw new AppError(404, 'no_edit', `у плейбука ${id} нет ждущей правки ${hash}`)
		const rest = pending.filter(x => x.hash !== hash)
		const applied = applyEdit(p, e.file, e.before, e.after)
		if (!applied) {
			this.setPendingEdits(id, rest)
			throw new AppError(409, 'stale_edit', `правку ${hash} уже нельзя применить: текст ${e.file} изменился`)
		}
		return this.saveVersion({ ...applied, pendingEdits: rest }, `Accepted edit in ${e.file}`, {
			kind: 'edit',
			subject: id,
			summary: `${id}: принята правка ${e.file} (кейс ${e.caseId})`,
			report: null,
			revertible: true,
			revertedBy: null,
		})
	}

	/** Отклонить ждущую правку: хэш уходит в `rejectedEdits`, улучшатель её больше не предложит. */
	rejectEdit(id: string, hash: string): PlaybookState {
		const p = this.need(id)
		const pending = p.pendingEdits ?? []
		if (!pending.some(x => x.hash === hash)) throw new AppError(404, 'no_edit', `у плейбука ${id} нет ждущей правки ${hash}`)
		const next: PlaybookState = { ...p, pendingEdits: pending.filter(x => x.hash !== hash), rejectedEdits: [...new Set([...p.rejectedEdits, hash])], updatedAt: this.iso() }
		this.deps.store.saveState(next)
		this.map.set(id, next)
		this.deps.hub.publish({ t: 'learning_playbook', playbook: playbookView(next) })
		return next
	}

	/** Отчёт ревью — в хранилище (`reviews/v<N>.json`, отдаётся в `PlaybookDetail.reviews`). */
	saveReview(r: ReviewReport): void {
		this.deps.store.saveReview(r)
	}

	/** Смена статуса правила (активация судьёй, архив): запись журнала с прежним статусом правила. */
	setRuleStatus(id: string, ruleId: string, status: RuleStatus, reason: string): PlaybookState {
		const p = this.need(id)
		const rule = p.rules.find(r => r.id === ruleId)
		if (!rule) throw new AppError(404, 'no_rule', `в плейбуке ${id} нет правила ${ruleId}`)
		if (rule.status === status) return p
		const saved = this.commit({ ...p, rules: p.rules.map(r => (r.id === ruleId ? { ...r, status } : r)) }, reason)
		this.record({
			kind: status === 'archived' ? 'rule_archived' : 'rule_activated',
			subject: id,
			summary: `${id}: правило «${rule.text}» ${rule.status} → ${status}. ${reason}`,
			report: JSON.stringify({ ruleId, prevStatus: rule.status }),
			revertible: true,
			revertedBy: null,
		})
		return saved
	}

	/**
	 * Откат содержания к версии (см. `restoreContent`); выходит новая версия. Записи `version`/`edit` новее
	 * этой версии помечаются откаченными.
	 */
	revertToVersion(id: string, version: number): PlaybookState {
		const p = this.need(id)
		const restored = this.deps.store.restoreVersion(id, version)
		if (!restored) throw new AppError(404, 'no_version', `у плейбука ${id} нет версии ${version}`)
		const saved = this.commit(restoreContent(p, restored.state), `Revert to version ${version}`)
		const done = this.record({ kind: 'reverted', subject: id, summary: `${id}: откат к версии ${version}`, report: JSON.stringify({ version: saved.version }), revertible: false, revertedBy: null })
		for (const e of this.deps.store.loadJournal(Number.MAX_SAFE_INTEGER)) {
			const v = parseReport(e.report)['version']
			if (e.subject !== id || e.revertedBy || e.id === done.id || (e.kind !== 'version' && e.kind !== 'edit') || typeof v !== 'number' || v <= version) continue
			const marked: JournalEntry = { ...e, revertedBy: done.id }
			this.deps.store.updateJournal(marked)
			this.deps.hub.publish({ t: 'learning_journal', entry: marked })
		}
		return saved
	}

	/** Записывает решение в журнал и публикует `learning_journal`. */
	record(entry: NewEntry): JournalEntry {
		const full: JournalEntry = { ...entry, id: `jr-${this.deps.ids.next(8)}`, ts: this.iso() }
		this.deps.store.appendJournal(full)
		this.deps.hub.publish({ t: 'learning_journal', entry: full })
		return full
	}

	/** В плагин `nessy-playbooks` уходят плейбуки `trial` и `active`. */
	publishActive(): void {
		const live = this.list().filter(p => isLive(p.status))
		this.publishCount += 1
		const version = this.deps.pluginVersion?.() ?? `1.0.${this.publishCount}`
		this.deps.store.publish(
			// заметки пользователя берутся из хранилища заметок, а не из снимка в `files/`
			live.map(p => ({ id: p.id, files: { ...this.deps.store.readFiles(p.id), 'notes.md': this.deps.store.readNotes(p.id) || '# Notes\n' } })),
			version,
		)
	}

	/**
	 * Откат решения из журнала; возвращает новую запись `reverted`, у исходной появляется `revertedBy`.
	 * Статус и статус правила возвращаются к прежнему, версия — к предыдущей (новой версией).
	 */
	revert(journalId: string): JournalEntry {
		const { store } = this.deps
		const e = store.loadJournal(Number.MAX_SAFE_INTEGER).find(x => x.id === journalId)
		if (!e) throw new AppError(404, 'no_journal', `нет записи журнала ${journalId}`)
		if (e.revertedBy) throw new AppError(409, 'already_reverted', `запись ${journalId} уже откачена`)
		if (!e.revertible) throw new AppError(409, 'not_revertible', `запись ${journalId} откатить нельзя`)
		const rep = parseReport(e.report)
		const p = this.need(e.subject)
		const message = `Revert: ${e.summary}`
		const prev = rep['prevStatus']
		if (typeof rep['ruleId'] === 'string' && RULE_STATUSES.some(s => s === prev)) {
			const ruleId = rep['ruleId']
			const status = RULE_STATUSES.find(s => s === prev)
			if (!status || !p.rules.some(r => r.id === ruleId)) throw new AppError(409, 'not_revertible', `правило ${ruleId} не найдено`)
			this.commit({ ...p, rules: p.rules.map(r => (r.id === ruleId ? { ...r, status } : r)) }, message)
		} else if (STATUSES.some(s => s === prev)) {
			const status = STATUSES.find(s => s === prev)
			if (!status) throw new AppError(409, 'not_revertible', 'нет прежнего статуса')
			this.commit({ ...p, status }, message)
		} else if (typeof rep['version'] === 'number' && rep['version'] > 1) {
			const restored = store.restoreVersion(p.id, rep['version'] - 1)
			if (!restored) throw new AppError(409, 'not_revertible', `версия ${rep['version'] - 1} недоступна`)
			this.commit(restoreContent(p, restored.state), message)
		} else {
			throw new AppError(409, 'not_revertible', `у записи ${journalId} нет данных для отката`)
		}
		const done = this.record({ kind: 'reverted', subject: e.subject, summary: message, report: JSON.stringify({ reverted: journalId }), revertible: false, revertedBy: null })
		const marked: JournalEntry = { ...e, revertedBy: done.id }
		store.updateJournal(marked)
		this.deps.hub.publish({ t: 'learning_journal', entry: marked })
		return done
	}

	remove(id: string): void {
		const p = this.need(id)
		this.deps.store.removePlaybook(id)
		this.map.delete(id)
		this.deps.hub.publish({ t: 'learning_playbook_removed', id })
		if (isLive(p.status)) this.publishActive()
	}

	notes(id: string): string {
		this.need(id)
		return this.deps.store.readNotes(id)
	}

	/** Заметки пользователя; автоматически не переписываются. Живой плейбук публикуется заново. */
	setNotes(id: string, text: string): void {
		const p = this.need(id)
		this.deps.store.writeNotes(id, text)
		if (isLive(p.status)) this.publishActive()
	}

	/**
	 * Сохраняет новую версию: файлы рендерятся из состояния. Публикует плагин, если плейбук был или стал живым.
	 */
	private commit(p: PlaybookState, message: string): PlaybookState {
		const { store } = this.deps
		const prev = this.map.get(p.id)
		const prevFiles = store.readFiles(p.id)
		const version = store.versions(p.id).length + 1
		const iso = this.iso()
		const next: PlaybookState = { ...p, version, updatedAt: iso }
		const changelog = addChangelog(prevFiles['CHANGELOG.md'] ?? '', version, iso.slice(0, 10), [message])
		const files = renderPlaybook(next, store.readNotes(p.id), changelog)
		const n = store.savePlaybook(next, files, message)
		const saved: PlaybookState = n === version ? next : { ...next, version: n }
		this.map.set(saved.id, saved)
		this.deps.hub.publish({ t: 'learning_playbook', playbook: playbookView(saved) })
		if (isLive(saved.status) || (prev !== undefined && isLive(prev.status))) this.publishActive()
		return saved
	}

	private iso(): string {
		return new Date(this.deps.clock.now()).toISOString()
	}
}
