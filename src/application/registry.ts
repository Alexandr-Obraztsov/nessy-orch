import { YOU } from '../domain/constants'
import { AppError } from '../domain/errors'
import type { Agent } from './agent/agent'
import type { SpaceRuntime } from './ports'

/** Реестр пространств и агентов + разрешение ссылок (id или имя). */
export class Registry {
	readonly spaces = new Map<string, SpaceRuntime>()
	readonly agents = new Map<string, Agent>()

	getSpace(name: string): SpaceRuntime | undefined {
		return this.spaces.get(name)
	}

	/** Агент по id или имени (без учёта регистра). */
	resolveAgent(ref: string): Agent {
		const byId = this.agents.get(ref)
		if (byId) return byId
		const hits = [...this.agents.values()].filter(a => a.name.toLowerCase() === ref.toLowerCase())
		if (hits.length === 1) return hits[0] as Agent
		if (hits.length > 1) throw new AppError(409, 'ambiguous_agent', `имя «${ref}» неоднозначно: ${hits.map(a => a.id).join(', ')}`)
		throw new AppError(404, 'no_agent', `агент «${ref}» не найден`)
	}

	/** Отправитель: `you` или агент по id/имени; неизвестный → 400 bad_from. */
	resolveSender(ref: string | undefined): string {
		if (!ref || ref === YOU) return YOU
		try {
			return this.resolveAgent(ref).id
		} catch {
			throw new AppError(400, 'bad_from', `неизвестный отправитель: ${ref}`)
		}
	}

	isNameTaken(name: string): boolean {
		const n = name.toLowerCase()
		return [...this.agents.values()].some(a => a.name.toLowerCase() === n)
	}

	labelOf(id: string): string {
		if (id === YOU) return 'you (главный оператор)'
		const a = this.agents.get(id)
		return a ? (a.name === a.id ? a.id : `${a.name} (${a.id})`) : id
	}
}
