/** Пространства: добавление, удаление, разрешение по имени/пути. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SpaceRequest, SpaceView } from '../../../shared/types'
import { PALETTE } from '../../domain/constants'
import { AppError } from '../../domain/errors'
import { defaultSpaceName, normalizeWorkspacePath, uniqueName } from '../../domain/naming'
import type { SpaceFactory, SpaceInit, SpaceRuntime } from '../ports'
import type { ServiceContext } from './context.types'

export class SpacesService {
	constructor(
		private readonly ctx: ServiceContext,
		private readonly factory: SpaceFactory,
	) {}

	/** Создать объект пространства (процесс serve поднимается лениво). */
	make(init: SpaceInit): SpaceRuntime {
		const { ctx } = this
		return this.factory(init, {
			onStatus: s => ctx.hub.publish({ t: 'space', space: s.toJSON() }),
			onExit: (space, info) => {
				if (ctx.isShuttingDown() || info.intended) return
				const reason = `nessy serve пространства «${space.name}» завершился (code=${info.code}, signal=${info.signal})`
				for (const a of ctx.registry.agents.values()) if (a.space === space.name) a.onSpaceDown(reason)
			},
		})
	}

	add(req: SpaceRequest): SpaceView {
		const { registry } = this.ctx
		if (!req.path || !path.isAbsolute(req.path)) throw new AppError(400, 'bad_path', 'path должен быть абсолютным путём к воркспейсу')
		const p = normalizeWorkspacePath(req.path)
		if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new AppError(400, 'bad_path', `каталог не найден: ${p}`)
		const existing = [...registry.spaces.values()].find(s => s.path === p)
		if (existing) return existing.toJSON()
		if (req.name && registry.spaces.has(req.name)) throw new AppError(409, 'space_exists', `пространство «${req.name}» уже существует`)
		const name = req.name ?? uniqueName(defaultSpaceName(p), n => registry.spaces.has(n))
		const color = PALETTE[registry.spaces.size % PALETTE.length] ?? 210
		const space = this.make({ name, path: p, url: req.url ?? null, color })
		registry.spaces.set(name, space)
		this.ctx.hub.publish({ t: 'space', space: space.toJSON() })
		this.ctx.saveSoon()
		return space.toJSON()
	}

	async remove(name: string, force: boolean, removeAgent: (id: string) => Promise<void>): Promise<void> {
		const { registry } = this.ctx
		const space = registry.spaces.get(name)
		if (!space) throw new AppError(404, 'no_space', `пространство «${name}» не найдено`)
		const inside = [...registry.agents.values()].filter(a => a.space === name)
		if (inside.length && !force)
			throw new AppError(409, 'space_busy', `в пространстве ${inside.length} агент(ов); укажите force, чтобы удалить их`)
		for (const a of inside) await removeAgent(a.id)
		await space.stop()
		registry.spaces.delete(name)
		this.ctx.hub.publish({ t: 'space_removed', name })
		this.ctx.saveSoon()
	}

	/** Имя пространства, путь или пусто (если пространство единственное). Неизвестный путь добавляется. */
	resolve(spec?: string): SpaceRuntime {
		const { spaces } = this.ctx.registry
		if (!spec) {
			if (spaces.size === 1) return [...spaces.values()][0] as SpaceRuntime
			throw new AppError(
				400,
				'space_required',
				spaces.size ? 'укажите пространство (--space): их несколько' : 'пространств нет: добавьте `nessy-orch space add <путь>`',
			)
		}
		const byName = spaces.get(spec)
		if (byName) return byName
		if (path.isAbsolute(spec)) {
			const norm = normalizeWorkspacePath(spec)
			const byPath = [...spaces.values()].find(s => s.path === norm)
			if (byPath) return byPath
			const v = this.add({ path: norm })
			return spaces.get(v.name) as SpaceRuntime
		}
		throw new AppError(404, 'no_space', `пространство «${spec}» не найдено`)
	}
}
