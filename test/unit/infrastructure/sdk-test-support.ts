/**
 * Общие хелперы unit-тестов NessySdkAgentPort: фейковый Query, билдеры SDKMessage, makePort, waitFor.
 * Вынесено из agent-port-sdk.test.ts, чтобы оба test-файла (основной и волны A) укладывались в max-lines.
 */
import type { Query, QueryOptions, SDKMessage, SDKUserMessage, PermissionResult } from '@nestor/nessy-cli-sdk'
import { NessySdkAgentPort, type MakeQuery } from '../../../src/infrastructure/nessy/agent-port-sdk'

/** Скрипт ответа модели на промпт: список SDKMessage либо 'hang' (держит ход открытым). */
export type Respond = (text: string) => SDKMessage[] | 'hang'

export const sdkMsg = (m: unknown): SDKMessage => m as SDKMessage
export const initMsg = (model = 'm'): SDKMessage =>
	sdkMsg({
		type: 'system',
		subtype: 'init',
		uuid: 'u',
		session_id: 's',
		model,
		cwd: '/ws',
		tools: [],
		mcp_servers: [],
		permission_mode: 'default',
		nessy_cli_version: '0.8.6',
	})
export const deltaMsg = (text: string): SDKMessage =>
	sdkMsg({
		type: 'stream_event',
		uuid: 'u',
		session_id: 's',
		parent_tool_use_id: null,
		event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
	})
export const assistantMsg = (text: string): SDKMessage =>
	sdkMsg({
		type: 'assistant',
		uuid: 'u',
		session_id: 's',
		parent_tool_use_id: null,
		message: {
			id: 'm1',
			type: 'message',
			role: 'assistant',
			model: 'm',
			content: [{ type: 'text', text }],
			stop_reason: 'end_turn',
			usage: { input_tokens: 2, output_tokens: 3 },
		},
	})
/** assistant-сообщение с произвольными content-блоками (для tool-сценария conformance). */
export const assistantMsgWithBlocks = (content: unknown[]): SDKMessage =>
	sdkMsg({
		type: 'assistant',
		uuid: 'u',
		session_id: 's',
		parent_tool_use_id: null,
		message: {
			id: 'm1',
			type: 'message',
			role: 'assistant',
			model: 'm',
			content,
			stop_reason: 'end_turn',
			usage: { input_tokens: 2, output_tokens: 3 },
		},
	})
export const resultSuccess = (text = 'ok'): SDKMessage =>
	sdkMsg({
		type: 'result',
		subtype: 'success',
		uuid: 'u',
		session_id: 's',
		is_error: false,
		duration_ms: 10,
		duration_api_ms: 9,
		num_turns: 1,
		result: text,
		usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
		permission_denials: [],
	})
export const resultError = (): SDKMessage =>
	sdkMsg({
		type: 'result',
		subtype: 'error_during_execution',
		uuid: 'u',
		session_id: 's',
		is_error: true,
		duration_ms: 10,
		duration_api_ms: 9,
		num_turns: 1,
		result: '',
		usage: {},
		permission_denials: [],
		error: { type: 'execution', message: 'стек' },
	})

/** Фейковый Query: читает очередь промптов адаптера и отвечает по скрипту `respond`. */
export class FakeQuery {
	calls: string[] = []
	interrupted = false
	private hangResolve: (() => void) | null = null
	private interruptReject: ((e: Error) => void) | null = null
	readonly initialized: Promise<void> = Promise.resolve()

	constructor(
		private readonly prompt: AsyncIterable<SDKUserMessage>,
		private readonly respond: Respond,
		private readonly options: QueryOptions | undefined,
	) {}

	async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage> {
		yield initMsg()
		for await (const um of this.prompt) {
			const text = um.message.content as string
			const resp = this.respond(text)
			if (resp === 'hang') {
				await new Promise<void>((res, rej) => {
					this.hangResolve = res
					this.interruptReject = rej
				})
				if (this.interrupted) throw new Error('CLI process exited with code 130')
				continue
			}
			for (const m of resp) yield m
		}
	}

	/** Пробросить canUseTool-вызов из опций (для unit-проверок permission.vote). */
	canUseTool(toolName: string, input: Record<string, unknown>): Promise<PermissionResult> {
		const opts = this.options
		if (!opts?.canUseTool) return Promise.resolve({ behavior: 'deny', message: 'нет canUseTool в опциях' })
		const signal = opts.abortController ? opts.abortController.signal : new AbortController().signal
		return opts.canUseTool(toolName, input, { signal })
	}

	aborted(): boolean {
		return !!this.options?.abortController?.signal.aborted
	}

	resumeFlag(): string | undefined {
		return this.options?.resume
	}

	modelOption(): string | undefined {
		return this.options?.model
	}

	envOption(): Record<string, string> | undefined {
		return this.options?.env
	}

	interrupt(): Promise<void> {
		this.calls.push('interrupt')
		this.interrupted = true
		if (this.interruptReject) {
			const rej = this.interruptReject
			this.interruptReject = null
			rej(new Error('CLI process exited with code 130'))
		}
		return Promise.resolve()
	}
	close(): Promise<void> {
		this.calls.push('close')
		if (this.hangResolve) {
			const r = this.hangResolve
			this.hangResolve = null
			r()
		}
		return Promise.resolve()
	}
	setModel(model: string): Promise<void> {
		this.calls.push(`setModel:${model}`)
		return Promise.resolve()
	}
	getSessionId(): string {
		return 'sess'
	}
	isClosed(): boolean {
		return false
	}
}

export interface SdkPortFixture {
	port: NessySdkAgentPort
	lastQuery: () => FakeQuery
	resumeFlag: () => string | undefined
}

/** Адаптер на фейковом Query: `respond` управляет поведением модели на каждый промпт. */
export function makePort(respond: Respond, model?: string): SdkPortFixture {
	let last: FakeQuery | null = null
	const makeQuery: MakeQuery = args => {
		const q = new FakeQuery(args.prompt as AsyncIterable<SDKUserMessage>, respond, args.options)
		last = q
		return q as unknown as Query
	}
	const port = new NessySdkAgentPort({ cwd: '/ws', ...(model !== undefined ? { model } : {}), clock: { now: () => 123 }, makeQuery })
	return { port, lastQuery: () => last as FakeQuery, resumeFlag: () => last?.resumeFlag() }
}

export const defaultRespond: Respond = text => {
	if (text === '#slow') return 'hang'
	if (text === '#error') return [resultError()]
	if (text === '#tools')
		return [
			assistantMsgWithBlocks([
				{ type: 'tool_use', id: 't1', name: 'grep', input: { query: 'x' } },
				{ type: 'tool_result', tool_use_id: 't1', content: 'найдено 0', is_error: false },
			]),
			resultSuccess(),
		]
	return [deltaMsg('x'), assistantMsg('x'), resultSuccess()]
}

/** Дождаться появления события `type` в массиве событий (опрашивает каждые 5мс). */
export function waitFor(events: Array<string | { type: string }>, type: string): Promise<void> {
	const has = (): boolean => events.some(e => (typeof e === 'string' ? e : e.type) === type)
	return new Promise((resolve, reject) => {
		const t0 = Date.now()
		const timer = setInterval(() => {
			if (has()) {
				clearInterval(timer)
				resolve()
			} else if (Date.now() - t0 > 2000) {
				clearInterval(timer)
				reject(new Error(`не дождались ${type}; получено: ${events.map(e => (typeof e === 'string' ? e : e.type)).join(', ') || 'ничего'}`))
			}
		}, 5)
	})
}
