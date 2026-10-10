/**
 * Отображение событий `nessy serve` (SSE-кадры) во внутренние SessionEvent.
 * Единственное место (вместе с nessy-client.ts), знающее протокол nessy; контракт — docs/contract/README.md.
 *
 * Состояние маппера — только буфер инструментов по toolCallId: `title`/`rawInput` приходят
 * лишь в tool_call, а в tool_call_update их нет — без буфера обновление теряет заголовок.
 */
import type { PlanEntry, PlanStatus, ToolStatus } from '../../../shared/types'
import type { SessionEvent } from '../../application/ports'
import type { PermissionOption } from '../../domain/types'
import { arr, isObject, obj, str, strOrNull } from '../../lib/json'
import type { JsonObject } from '../../lib/json.types'
import type { ToolCallBuffer } from './protocol.types'
import { buildToolOutput } from './tool-output'

const ERROR_META_KEY = 'nessy/error'

/** Статус инструмента nessy → один из четырёх наших. null — статуса нет/неизвестен. */
export function mapToolStatus(v: unknown): ToolStatus | null {
	switch (v) {
		case 'pending':
		case 'in_progress':
		case 'completed':
		case 'failed':
			return v
		case 'cancelled':
		case 'canceled':
		case 'error':
			return 'failed'
		default:
			return null
	}
}

/** Слить tool_call/tool_call_update с накопленным состоянием (как mergeToolCallBuffer в референсе). */
export function mergeToolCall(prev: ToolCallBuffer | undefined, u: JsonObject): ToolCallBuffer {
	const meta = obj(u['_meta'])
	return {
		name: str(meta['toolName']) || prev?.name || str(u['kind']) || 'tool',
		title: typeof u['title'] === 'string' && u['title'] ? u['title'] : (prev?.title ?? ''),
		rawInput: u['rawInput'] ?? prev?.rawInput,
		content: Array.isArray(u['content']) ? u['content'] : (prev?.content ?? []),
		rawOutput: u['rawOutput'] ?? prev?.rawOutput,
		status: mapToolStatus(u['status']) ?? prev?.status ?? 'in_progress',
	}
}

function toolEvent(toolId: string, b: ToolCallBuffer): SessionEvent {
	return {
		kind: 'tool',
		toolId,
		name: b.name,
		title: b.title || b.name,
		input: isObject(b.rawInput) ? b.rawInput : b.rawInput === undefined ? {} : { value: b.rawInput },
		status: b.status,
		output: buildToolOutput(b.rawOutput, b.content),
	}
}

/** Статус шага плана ACP; неизвестный — pending. */
function mapPlanStatus(v: unknown): PlanStatus {
	return v === 'in_progress' || v === 'completed' ? v : 'pending'
}

/** ACP `plan`: entries[] = {content, priority, status}; priority оркестратору не нужен. */
function mapPlan(u: JsonObject): SessionEvent {
	const entries = arr(u['entries']).map((e): PlanEntry => {
		const o = obj(e)
		return { content: str(o['content']), status: mapPlanStatus(o['status']) }
	})
	return { kind: 'plan', entries }
}

function mapSessionUpdate(u: JsonObject, tools: Map<string, ToolCallBuffer>): SessionEvent | null {
	const su = str(u['sessionUpdate'])
	if (su === 'agent_message_chunk' || su === 'agent_thought_chunk') {
		const content = obj(u['content'])
		const text = str(content['text'])
		const messageId = strOrNull(u['messageId'])
		const err = obj(content['_meta'])[ERROR_META_KEY]
		if (su === 'agent_message_chunk' && isObject(err)) {
			return {
				kind: 'turn_error',
				message: str(err['message']) || text || 'ошибка nessy',
				retryable: err['retryable'] === true,
				code: typeof err['code'] === 'number' ? err['code'] : null,
			}
		}
		if (!text) return null
		return { kind: su === 'agent_message_chunk' ? 'text' : 'thought', text, messageId }
	}
	if (su === 'tool_call' || su === 'tool_call_update') {
		const toolId = str(u['toolCallId'])
		if (!toolId) return null
		const b = mergeToolCall(tools.get(toolId), u)
		if (b.status === 'completed' || b.status === 'failed') tools.delete(toolId)
		else tools.set(toolId, b)
		return toolEvent(toolId, b)
	}
	if (su === 'plan') return mapPlan(u)
	return null // user_message_chunk (эхо), current_mode_update, session_info_update, available_commands_update
}

function mapPermission(d: JsonObject): SessionEvent {
	const tc = obj(d['toolCall'])
	const options = arr(d['options']).map((o): PermissionOption => {
		const oo = obj(o)
		return { optionId: str(oo['optionId']), kind: str(oo['kind']), name: str(oo['name']) }
	})
	return {
		kind: 'permission',
		requestId: str(d['requestId']),
		options,
		title: str(tc['title']) || str(obj(tc['_meta'])['toolName']) || 'действие',
	}
}

function followupText(d: JsonObject): string {
	return str(d['suggestion']) || str(d['text']) || arr(d['suggestions']).map(s => str(s)).filter(Boolean).join('\n')
}

/**
 * Привести кадр nessy к внутренней форме. null — событие оркестратору не нужно.
 * `tools` — буфер инструментов этой подписки (мутируется). Вход — произвольный JSON.
 */
export function mapNessyEvent(eventName: string, frame: unknown, tools: Map<string, ToolCallBuffer>): SessionEvent | null {
	if (!isObject(frame)) return null
	const type = str(frame['type'], eventName)
	const d = obj(frame['data'])
	switch (type) {
		case 'session_update':
			return mapSessionUpdate(obj(d['update']), tools)
		case 'turn_complete':
			tools.clear()
			return { kind: 'turn_complete', stopReason: str(d['stopReason'], 'end_turn'), promptId: strOrNull(d['promptId']) }
		case 'turn_error':
			return {
				kind: 'turn_error',
				message: str(d['message']) || 'ошибка nessy',
				retryable: d['retryable'] === true,
				code: typeof d['code'] === 'number' ? d['code'] : null,
			}
		case 'prompt_cancelled':
			return { kind: 'cancelled', promptId: strOrNull(d['promptId']) }
		case 'session_metadata_updated': {
			const displayName = str(d['displayName'])
			return displayName ? { kind: 'meta', displayName } : null
		}
		case 'permission_request':
			return mapPermission(d)
		case 'followup_suggestion': {
			const text = followupText(d)
			return text ? { kind: 'followup', text } : null
		}
		case 'session_died':
			return { kind: 'died', reason: 'процесс агента nessy завершился' }
		case 'client_evicted':
			return { kind: 'evicted' }
		default:
			return null
	}
}

/** Маппер с собственным буфером инструментов (по одному на подписку). */
export class NessyEventMapper {
	private readonly tools = new Map<string, ToolCallBuffer>()

	map(eventName: string, frame: unknown): SessionEvent | null {
		return mapNessyEvent(eventName, frame, this.tools)
	}
}
