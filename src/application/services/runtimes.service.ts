/** Каталог рантаймов для `GET /runtimes`: описания из конфигурации + модели, уже встретившиеся у пространств и агентов. */
import type { RuntimeInfo, RuntimeModel } from '../../../shared/types'
import { modelMatches } from '../../domain/models'
import type { RuntimeCatalogSource } from '../ports'
import type { ServiceContext } from './context.types'

export class RuntimesService {
	constructor(
		private readonly ctx: ServiceContext,
		private readonly catalog: RuntimeCatalogSource,
	) {}

	list(): RuntimeInfo[] {
		return this.catalog().map(d => ({
			id: d.id,
			label: d.label,
			defaultModel: d.defaultModel,
			models: this.withSeen(d.id, d.models),
			capabilities: { ...d.capabilities },
			available: d.available,
		}))
	}

	/** Известные модели + модели пространств рантайма и фактические модели его агентов (без повторов и без выдуманных). */
	private withSeen(runtime: RuntimeInfo['id'], known: readonly RuntimeModel[]): RuntimeModel[] {
		const out = [...known]
		const add = (m: string | null | undefined): void => {
			if (!m || out.some(k => k.id === m || modelMatches(k.id, m))) return
			out.push({ id: m, label: m })
		}
		const { registry } = this.ctx
		for (const s of registry.spaces.values()) if (s.runtime === runtime) add(s.model)
		for (const a of registry.agents.values()) if (registry.getSpace(a.space)?.runtime === runtime) add(a.modelActual)
		return out
	}
}
