/**
 * Рантаймы агентов (дизайн AgentPort §8): выбор рантайма для `spawn --runtime`.
 * nessy-sdk — встроенный исполняющий агент; tclaude — локальный Claude Code (главный агент).
 */
import type { RuntimeId } from '../../../shared/types'
import { RUNTIME_IDS, isRuntimeId } from '../../domain/constants'
import { CliError } from './errors'

export type { RuntimeId } from '../../../shared/types'

/** Парсинг --runtime: пусто → undefined, иначе проверка на известный рантайм (CliError с кодом 2). */
export function parseRuntimeId(v: string | undefined): RuntimeId | undefined {
	if (v === undefined) return undefined
	if (!isRuntimeId(v)) throw new CliError(`неизвестный рантайм «${v}»: ожидается ${RUNTIME_IDS.join(' | ')}`, 2)
	return v
}
