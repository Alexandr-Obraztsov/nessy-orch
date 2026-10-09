/**
 * Задачи оркестраторов («ящики»): хранение (tasks.json), создание, правка, закрытие и удаление.
 * Каждый Claude заводит свою задачу, агенты привязываются к ней, у задачи свой inbox (курсор — в ленте).
 * Правила полей — domain/tasks.ts.
 */
import type { TaskPatch, TaskRequest, TaskStatus, TaskView } from '../../../shared/types'
import { AppError } from '../../domain/errors'
import { isTaskId, taskIdFrom, validateTaskPatch, validateTaskRequest } from '../../domain/tasks'
import { hexId } from '../../lib/ids'
import type { ServiceContext } from './context.types'

export class TasksService {
	private readonly tasks = new Map<string, TaskView>()

	constructor(
		private readonly ctx: ServiceContext,
		/** суффикс id задачи (по умолчанию 4 hex) — подменяется в тестах */
		private readonly suffix: () => string = () => hexId(4),
	) {}

	load(): void {
		this.tasks.clear()
		for (const t of this.ctx.store.loadTasks()) if (isTaskId(t.id)) this.tasks.set(t.id, t)
	}

	get count(): number {
		return this.tasks.size
	}

	/** Задачи: сначала активные, внутри — по свежести (updatedAt). */
	list(status?: TaskStatus): TaskView[] {
		return [...this.tasks.values()]
			.filter(t => status === undefined || t.status === status)
			.sort((a, b) => (a.status === b.status ? b.updatedAt.localeCompare(a.updatedAt) : a.status === 'active' ? -1 : 1))
	}

	has(id: string): boolean {
		return this.tasks.has(id)
	}

	/** Задача по id; неизвестная → 404 no_task. */
	resolve(ref: string): TaskView {
		const hit = this.tasks.get(ref.trim().toLowerCase())
		if (!hit) throw new AppError(404, 'no_task', `задача «${ref}» не найдена`)
		return hit
	}

	create(req: TaskRequest): TaskView {
		const f = validateTaskRequest(req)
		let id = f.id
		if (id !== null) {
			if (this.tasks.has(id)) throw new AppError(409, 'task_exists', `задача с id «${id}» уже есть`)
		} else {
			do id = taskIdFrom(f.title, this.suffix())
			while (this.tasks.has(id))
		}
		const now = this.isoNow()
		const task: TaskView = { id, title: f.title, owner: f.owner, status: 'active', summary: null, createdAt: now, updatedAt: now }
		this.put(task)
		return task
	}

	/** Частичная правка: заголовок, статус (done ставит оркестратор), итог. */
	update(ref: string, patch: TaskPatch): TaskView {
		const prev = this.resolve(ref)
		const p = validateTaskPatch(patch)
		const task: TaskView = {
			...prev,
			title: p.title ?? prev.title,
			status: p.status ?? prev.status,
			summary: p.summary !== undefined ? p.summary : prev.summary,
			updatedAt: this.isoNow(),
		}
		this.put(task)
		return task
	}

	/**
	 * Удалить задачу: только если в ней нет работающих агентов (иначе 409 task_busy).
	 * Агенты задачи остаются, но отвязываются от неё (task = null); курсор inbox задачи забывается.
	 */
	remove(ref: string): void {
		const task = this.resolve(ref)
		const { registry } = this.ctx
		const inside = [...registry.agents.values()].filter(a => a.task === task.id)
		const busy = inside.filter(a => a.isBusy || a.queue.length)
		if (busy.length)
			throw new AppError(
				409,
				'task_busy',
				`в задаче работают агенты: ${busy.map(a => registry.labelOf(a.id)).join(', ')} — прервите их (cancel) или дождитесь ответа`,
			)
		this.tasks.delete(task.id)
		this.save()
		for (const a of inside) a.setTask(null)
		this.ctx.feed.forgetTask(task.id)
		this.ctx.hub.publish({ t: 'task_removed', id: task.id })
	}

	private put(task: TaskView): void {
		this.tasks.set(task.id, task)
		this.save()
		this.ctx.hub.publish({ t: 'task', task })
	}

	private save(): void {
		this.ctx.store.saveTasks([...this.tasks.values()])
	}

	private isoNow(): string {
		return new Date(this.ctx.clock.now()).toISOString()
	}
}
