/** HTTP/SSE-клиент CLI к оркестратору. */
import * as http from 'node:http'
import type { AgentStreamEvent, ApiError, StreamEvent } from '../../../shared/types'
import { isObject, parseJson, str } from '../../lib/json'
import { SseParser } from '../../infrastructure/sse/sse-parser'
import type { Endpoint } from './client.types'
import { CliError } from './errors'

export function endpoint(env: NodeJS.ProcessEnv = process.env): Endpoint {
	const port = parseInt(env['ORCH_PORT'] ?? '', 10)
	return { host: '127.0.0.1', port: Number.isFinite(port) ? port : 4337 }
}

/** ключ агента (`--key`): подтверждает команды от его имени (`--from`) */
let agentKey: string | null = null
export function setAgentKey(key: string | undefined): void {
	agentKey = key?.trim() || null
}

/** Заголовки доступа: токен оператора из окружения терминала (у агентов nessy его нет) и ключ агента. */
function authHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
	const h: Record<string, string> = {}
	const token = env['NESSY_ORCH_TOKEN']?.trim()
	if (token) h['X-Orch-Token'] = token
	if (agentKey) h['X-Agent-Key'] = agentKey
	return h
}

const UNREACHABLE =
	'оркестратор недоступен. Приложение TClaude-Orch перезапускает службу само: повторите команду через несколько секунд. Не помогло: попросите пользователя открыть приложение или выполнить `nessy-orch install` в обычном терминале (из Claude Code службу не запустить)'

/** Сколько раз и как часто пробуем подключиться, пока служба перезапускается (отказ в соединении = запрос до сервера не дошёл, повтор безопасен). */
const CONNECT_ATTEMPTS = 5
const CONNECT_PAUSE_MS = 1500

export async function request(ep: Endpoint, method: string, path: string, body?: unknown): Promise<unknown> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await requestOnce(ep, method, path, body)
		} catch (e) {
			if (!(e instanceof ConnectRefused) || attempt >= CONNECT_ATTEMPTS) throw e instanceof ConnectRefused ? new CliError(UNREACHABLE) : e
			await new Promise<void>(r => setTimeout(r, CONNECT_PAUSE_MS))
		}
	}
}

/** Соединение не установлено: сервис не слушает порт. */
class ConnectRefused extends Error {}

function requestOnce(ep: Endpoint, method: string, path: string, body?: unknown): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? null : JSON.stringify(body)
		const req = http.request(
			{
				host: ep.host,
				port: ep.port,
				method,
				path,
				headers: { ...authHeaders(), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
			},
			res => {
				let d = ''
				res.setEncoding('utf8')
				res.on('data', (c: string) => (d += c))
				res.on('end', () => {
					const json = d ? parseJson(d) : {}
					if ((res.statusCode ?? 0) >= 400) {
						const e: Partial<ApiError> = isObject(json) ? { error: str(json['error']), code: str(json['code']) } : {}
						reject(new CliError(`${e.error || d || 'ошибка'}${e.code ? ` [${e.code}]` : ''}`))
						return
					}
					resolve(json)
				})
			},
		)
		req.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'ECONNREFUSED' ? new ConnectRefused() : new CliError(UNREACHABLE)))
		if (payload) req.write(payload)
		req.end()
	})
}

/** Подписка на SSE. Возвращает функцию остановки; промис завершается при разрыве соединения. */
export function sse(ep: Endpoint, path: string, onData: (data: unknown) => void): { done: Promise<void>; close: () => void } {
	let req: http.ClientRequest | null = null
	const done = new Promise<void>((resolve, reject) => {
		req = http.request({ host: ep.host, port: ep.port, method: 'GET', path, headers: { ...authHeaders(), Accept: 'text/event-stream' } }, res => {
			if (res.statusCode !== 200) {
				let d = ''
				res.on('data', (c: Buffer) => (d += c.toString()))
				res.on('end', () => {
					const j = parseJson(d)
					reject(new CliError(isObject(j) ? str(j['error'], d) : d))
				})
				return
			}
			res.setEncoding('utf8')
			const parser = new SseParser(f => {
				const v = parseJson(f.data)
				if (v !== undefined) onData(v)
			})
			res.on('data', (c: string) => parser.push(c))
			res.on('end', () => resolve())
			res.on('error', () => resolve())
		})
		req.on('error', () => reject(new CliError(UNREACHABLE)))
		req.end()
	})
	return { done, close: () => req?.destroy() }
}

// Узкие type guards для кадров потоков (данные приходят как unknown).
export const asStreamEvent = (v: unknown): StreamEvent | null => (isObject(v) && typeof v['t'] === 'string' ? (v as unknown as StreamEvent) : null)
export const asAgentStreamEvent = (v: unknown): AgentStreamEvent | null =>
	isObject(v) && typeof v['t'] === 'string' ? (v as unknown as AgentStreamEvent) : null
