/**
 * Каталог рантаймов: что умеет каждый и какие модели о нём известно. Capability-флаги — единый источник для адаптеров
 * и для `GET /runtimes`; список моделей — только подтверждённое (дефолт из конфигурации и псевдонимы tclaude), остальное
 * сервис дополняет моделями, уже встретившимися у пространств и агентов.
 */
import type { RuntimeId, RuntimeModel } from '../../shared/types'
import type { Capabilities } from './agent-port'
import type { RuntimeDescriptor } from './ports'

/** nessy-sdk: прямого mid-turn в канале SDK нет (§6б дизайна). */
export const SDK_CAPABILITIES: Capabilities = { streamText: true, midTurn: false, permissionVote: true, setModel: true }
/** tclaude: права решает сам Claude Code (голосования нет), смена модели — перезапуском процесса. */
export const TCLAUDE_CAPABILITIES: Capabilities = { streamText: true, midTurn: true, permissionVote: false, setModel: true }

/** Псевдонимы моделей tclaude, подтверждённые спайком (`--model opus|sonnet|haiku`). */
export const TCLAUDE_ALIASES: readonly RuntimeModel[] = [
	{ id: 'opus', label: 'Opus' },
	{ id: 'sonnet', label: 'Sonnet' },
	{ id: 'haiku', label: 'Haiku' },
]

export interface BuiltinRuntimeOptions {
	/** модель nessy-sdk по умолчанию (ORCH_SDK_MODEL) */
	sdkModel?: string | undefined
	/** модель tclaude по умолчанию (ORCH_TCLAUDE_MODEL) */
	tclaudeModel?: string | undefined
	/** бинарь tclaude найден */
	tclaudeAvailable?: boolean
}

/** Описания встроенных рантаймов (без моделей, замеченных у агентов). */
export function builtinRuntimes(o: BuiltinRuntimeOptions = {}): RuntimeDescriptor[] {
	const only = (m: string | undefined): RuntimeModel[] => (m ? [{ id: m, label: m }] : [])
	return [
		{ id: 'nessy-sdk', label: 'nessy (SDK)', defaultModel: o.sdkModel ?? null, models: only(o.sdkModel), capabilities: SDK_CAPABILITIES, available: true },
		{
			id: 'tclaude',
			label: 'tclaude (Claude Code)',
			defaultModel: o.tclaudeModel ?? null,
			models: [...TCLAUDE_ALIASES, ...only(o.tclaudeModel)],
			capabilities: TCLAUDE_CAPABILITIES,
			available: o.tclaudeAvailable ?? true,
		},
	]
}

/** Рантайм из списка по id (нет — undefined). */
export function findRuntime(list: readonly RuntimeDescriptor[], id: RuntimeId): RuntimeDescriptor | undefined {
	return list.find(r => r.id === id)
}
