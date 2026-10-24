/**
 * Подключение фонового обучения к оркестратору: хост (сессии, лента, занятость, запуск агентов) и сам `LearningService`.
 * Выделено из orchestrator.ts: оркестратор остаётся фасадом, а детали «как фон ходит к ленте и агентам» живут здесь.
 */
import * as os from 'node:os'
import * as path from 'node:path'
import { SERVICE_SESSION } from '../../domain/constants'
import type { OrchestratorDeps } from '../orchestrator.types'
import { LearningService } from './learning.service'
import type { LearningHost, LearningWiring } from './learning.types'

/** сколько последних сообщений читаем с диска, когда окна памяти не хватает (как в Feed) */
const DISK_HISTORY_LIMIT = 100_000
/** жёсткий предел ожидания фонового агента (сек); зависшего снимает сторож заданий (`stallMin`) */
const LEARNING_AGENT_TIMEOUT_SEC = 4 * 3600

/** Что фоновому обучению нужно от оркестратора: сессии, лента, занятость и запуск агентов. */
function learningHost(deps: OrchestratorDeps, w: LearningWiring): LearningHost {
	const { registry, feed, ops } = w
	return {
		sessions: () => w.sessions.list(),
		messagesSince: seq => {
			const mem = feed.recent(Number.MAX_SAFE_INTEGER)
			const first = mem[0]
			if (first && first.seq > seq + 1) return deps.store.loadMessages(DISK_HISTORY_LIMIT).filter(m => m.seq > seq)
			return mem.filter(m => m.seq > seq)
		},
		lastSeq: () => feed.msgSeq,
		sessionOfMessage: m => m.session ?? registry.agents.get(m.to)?.session ?? registry.agents.get(m.from)?.session ?? null,
		isBusy: ids => [...registry.agents.values()].some(a => a.session !== null && ids.includes(a.session) && (a.isBusy || a.queue.length > 0)),
		// агент уже мог уйти (ответил и удалён): отмена ничего не ломает
		cancelAgent: async agentId => {
			await ops.cancelAgent(agentId).catch(() => undefined)
		},
		agentAlive: id => {
			const a = registry.agents.get(id)
			return !!a && !a.isBusy && a.queue.length === 0 && a.status !== 'error'
		},
		noteAgent: (id, text, level) => registry.agents.get(id)?.addSystem(text, level),
		releaseAgent: async id => {
			await ops.removeAgent(id).catch(() => undefined)
		},
		agentActivity: id => {
			const a = registry.agents.get(id)
			return a ? Date.parse(a.lastActivityAt) || null : null
		},
		runAgent: async ({ name, title, prompt, agentId: reuse, onSpawn }) => {
			let agentId = reuse ?? ''
			try {
				// продолжение: сообщение живому агенту прошлой попытки, ответ ждём так же, как у нового
				if (reuse) {
					const res = await ops.send(reuse, { from: 'you', text: prompt, wait: true, waitTimeoutSec: LEARNING_AGENT_TIMEOUT_SEC })
					const ok = !!res.reply && !res.reply.failed
					if (ok) await ops.removeAgent(reuse).catch(() => undefined)
					return { agentId: reuse, text: res.reply?.text ?? '', ok, ...(ok ? {} : { error: res.reply?.text || 'агент не ответил' }) }
				}
				const casesDir = deps.learningStore?.casesDir ?? ''
				deps.learningStore?.ensureCasesDir()
				ops.ensureServiceSession(SERVICE_SESSION, 'Фон', casesDir)
				// модель и рантайм не задаём: фоновые агенты работают на дефолтных
				const res = await ops.spawn({ session: SERVICE_SESSION, name, title, prompt, wait: true, waitTimeoutSec: LEARNING_AGENT_TIMEOUT_SEC }, id => {
					agentId = id
					onSpawn?.(id)
				})
				agentId = res.agent.id
				const ok = !!res.reply && !res.reply.failed
				// удачного агента убираем (ответ сервис сохранит сам); упавший остаётся: ему пишет повтор задания, убирает сервис
				if (ok) await ops.removeAgent(agentId).catch(() => undefined)
				return { agentId, text: res.reply?.text ?? '', ok, ...(ok ? {} : { error: res.reply?.text || 'агент не ответил' }) }
			} catch (e) {
				return { agentId, text: '', ok: false, error: e instanceof Error ? e.message : String(e) }
			}
		},
	}
}

/** Фоновое обучение; null — хранилище не подключено (тесты, встраивание). */
export function createLearning(deps: OrchestratorDeps, w: LearningWiring): LearningService | null {
	const store = deps.learningStore
	if (!store) return null
	// Claude Code перечитывает плагин по версии: счётчик публикаций стартует с текущих секунд, чтобы версия росла и между запусками
	let n = Math.floor(w.ctx.clock.now() / 1000)
	const pluginVersion = (): string => `1.0.${n++}`
	return new LearningService({
		store,
		...(deps.playbookStore ? { playbookStore: deps.playbookStore, pluginVersion } : {}),
		host: learningHost(deps, w),
		hub: w.hub,
		clock: w.ctx.clock,
		ids: w.ctx.ids,
		defaultOn: deps.settings.learningDefaultOn ?? true,
		claudeProjectsDir: deps.settings.claudeProjectsDir ?? path.join(os.homedir(), '.claude', 'projects'),
	})
}
