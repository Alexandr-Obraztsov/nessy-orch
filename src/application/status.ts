/** Представление статуса оркестратора (GET /status). Выделено из orchestrator.ts по единой ответственности — «чтение». */
import type { StatusResponse } from '../../shared/types'
import type { Hub } from './hub'
import type { Registry } from './registry'

export interface StatusInput {
	version: string
	startedAt: number
	home: string
	autoApprove: boolean
}

export function buildStatus(input: StatusInput, hub: Hub, registry: Registry, rolesCount: number): StatusResponse {
	const agents = [...registry.agents.values()]
	return {
		version: input.version,
		pid: process.pid,
		uptimeSec: Math.round((Date.now() - input.startedAt) / 1000),
		rev: hub.rev,
		home: input.home,
		autoApprove: input.autoApprove,
		spaces: registry.spaces.size,
		agents: agents.length,
		working: agents.filter(a => a.status === 'working').length,
		roles: rolesCount,
	}
}
