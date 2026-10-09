/** Нативные уведомления macOS: запрос разрешения с кнопками, агент закончил, агент упал. */
import { Notification } from 'electron'
import type { AgentTracker } from '../lib/notify-policy'
import { describe } from '../lib/notify-policy'
import type { NotificationSpec, NotifyIntent } from '../types'

/** «Закончил» показываем с задержкой: ответ агента приходит следующим событием после архивации. */
const DONE_DELAY_MS = 700

export interface NotifierDeps {
	tracker: AgentTracker
	enabled(): boolean
	/** приложение сейчас перед глазами (окно или поповер в фокусе) */
	appFocused(): boolean
	openMain(query: string): void
	resolvePermission(agentId: string, requestId: string, approve: boolean): Promise<boolean>
	log(msg: string): void
}

export class Notifier {
	/** ссылки держим, иначе сборщик мусора убьёт уведомление вместе с обработчиками кнопок */
	private readonly live = new Map<string, Notification>()

	constructor(private readonly deps: NotifierDeps) {}

	handle(intents: NotifyIntent[]): void {
		for (const intent of intents) {
			if (intent.kind === 'permission_resolved') {
				this.close(`perm:${intent.agentId}:${intent.requestId}`)
				continue
			}
			if (!this.deps.enabled() || !Notification.isSupported()) continue
			if (intent.kind === 'done') {
				setTimeout(() => this.show(intent), DONE_DELAY_MS)
				continue
			}
			this.show(intent)
		}
	}

	closeAll(): void {
		for (const n of this.live.values()) n.close()
		this.live.clear()
	}

	private show(intent: Exclude<NotifyIntent, { kind: 'permission_resolved' }>): void {
		const agent = this.deps.tracker.agent(intent.agentId)
		// итог и ошибку и так видно, если приложение в фокусе; разрешение нужно всегда
		if (intent.kind !== 'permission' && this.deps.appFocused()) return
		const spec = describe(intent, agent, this.deps.tracker.task(agent?.task ?? null))
		if (this.live.has(spec.id)) return
		this.present(spec)
	}

	private present(spec: NotificationSpec): void {
		const n = new Notification({
			id: spec.id,
			groupId: 'nessy',
			title: spec.title,
			subtitle: spec.subtitle,
			body: spec.body,
			silent: spec.permission === null,
			actions: spec.permission
				? [
						{ type: 'button', text: 'Разрешить' },
						{ type: 'button', text: 'Отклонить' },
					]
				: [],
			closeButtonText: spec.permission ? 'Позже' : '',
		})
		const forget = (): void => {
			if (this.live.get(spec.id) === n) this.live.delete(spec.id)
		}
		n.on('click', () => {
			forget()
			this.deps.openMain(spec.query)
		})
		n.on('action', details => {
			forget()
			const perm = spec.permission
			if (!perm) return
			const approve = details.actionIndex === 0
			void this.deps.resolvePermission(perm.agentId, perm.requestId, approve).then(ok => {
				if (!ok) this.deps.log(`разрешение ${perm.requestId} уже решено или агент недоступен`)
			})
		})
		n.on('close', forget)
		n.on('failed', (_e, error) => {
			forget()
			this.deps.log('уведомление не показано: ' + error)
		})
		this.live.set(spec.id, n)
		n.show()
	}

	private close(id: string): void {
		const n = this.live.get(id)
		if (!n) return
		this.live.delete(id)
		n.close()
	}
}
