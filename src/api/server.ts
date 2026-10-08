/**
 * HTTP + SSE API оркестратора (loopback). Без зависимостей.
 *
 *   GET  /health                      GET  /status                    GET /graph
 *   GET  /spaces                      POST /spaces {path,name?,url?}  DELETE /spaces/:name?force=1
 *   GET  /agents                      POST /agents  (spawn)           GET /agents/:ref   DELETE /agents/:ref
 *   POST /agents/:ref/send            POST /agents/:ref/cancel
 *   POST /agents/:ref/permission/:requestId {approve}
 *   GET  /agents/:ref/history         GET  /agents/:ref/stream (SSE)
 *   GET  /messages?agent=&since=&limit=
 *   GET  /inbox?wait=&peek=1&after=
 *   GET  /stream (SSE: snapshot + все события)
 */
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import type {
	AgentStreamEvent,
	SendRequest,
	SpaceRequest,
	SpawnRequest,
	StreamEvent,
} from '../../shared/types'
import { formatFrame } from '../core/sse'
import { errMsg, isObject, parseJson } from '../core/json'
import type { Orchestrator } from '../core/orchestrator'
import { HttpError } from '../core/util'

const MAX_BODY = 5 * 1024 * 1024
const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.json': 'application/json; charset=utf-8',
}

export interface ServerOptions {
	version: string
	uiDir: string
	port: number
	host: string
}

export function createServer(
	orch: Orchestrator,
	opts: ServerOptions,
): http.Server {
	const allowedHosts = new Set([
		`127.0.0.1:${opts.port}`,
		`localhost:${opts.port}`,
		`[::1]:${opts.port}`,
	])

	const server = http.createServer((req, res) => {
		handle(req, res).catch((e: unknown) => {
			const status = e instanceof HttpError ? e.status : 500
			const code = e instanceof HttpError ? e.code : 'internal'
			if (res.headersSent) {
				res.end()
				return
			}
			sendJson(res, status, { error: errMsg(e), code })
		})
	})

	async function handle(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		// защита от DNS-rebinding и CSRF из браузера: агенты работают с автоподтверждением,
		// поэтому любая страница в браузере не должна уметь дергать API
		const hostHdr = (req.headers.host ?? '').toLowerCase()
		if (!allowedHosts.has(hostHdr))
			throw new HttpError(403, 'bad_host', 'недопустимый Host')
		const origin = req.headers.origin
		if (origin !== undefined) {
			const o = origin.toLowerCase()
			if (
				o !== `http://127.0.0.1:${opts.port}` &&
				o !== `http://localhost:${opts.port}`
			)
				throw new HttpError(403, 'bad_origin', 'недопустимый Origin')
		}

		const url = new URL(req.url ?? '/', 'http://localhost')
		const p = url.pathname
		const m = req.method ?? 'GET'
		const q = url.searchParams
		const seg = p.split('/').filter(Boolean).map(decodeURIComponent)

		// ---------- статика UI ----------
		if (m === 'GET' && !isApiPath(seg[0])) return serveStatic(res, p, opts.uiDir)

		// ---------- служебное ----------
		if (m === 'GET' && p === '/health') return sendJson(res, 200, { status: 'ok' })
		if (m === 'GET' && p === '/status')
			return sendJson(res, 200, orch.status(opts.version))
		if (m === 'GET' && p === '/graph') return sendJson(res, 200, orch.graph())

		// ---------- потоки ----------
		if (m === 'GET' && p === '/stream') return streamAll(req, res)
		if (m === 'GET' && seg[0] === 'agents' && seg[2] === 'stream' && seg[1])
			return streamAgent(req, res, seg[1])

		// ---------- пространства ----------
		if (seg[0] === 'spaces') {
			if (m === 'GET' && seg.length === 1)
				return sendJson(res, 200, orch.graph().spaces)
			if (m === 'POST' && seg.length === 1) {
				const body = await readBody(req)
				return sendJson(res, 201, orch.addSpace(parseSpaceRequest(body)))
			}
			if (m === 'DELETE' && seg.length === 2 && seg[1]) {
				await orch.removeSpace(seg[1], q.get('force') === '1')
				return sendJson(res, 200, { ok: true })
			}
		}

		// ---------- агенты ----------
		if (seg[0] === 'agents') {
			if (m === 'GET' && seg.length === 1)
				return sendJson(res, 200, orch.graph().agents)
			if (m === 'POST' && seg.length === 1) {
				const body = await readBody(req)
				return sendJson(res, 201, await orch.spawn(parseSpawnRequest(body)))
			}
			const ref = seg[1]
			if (ref) {
				if (m === 'GET' && seg.length === 2)
					return sendJson(res, 200, orch.getAgent(ref))
				if (m === 'DELETE' && seg.length === 2) {
					await orch.removeAgent(ref)
					return sendJson(res, 200, { ok: true })
				}
				if (m === 'GET' && seg[2] === 'history')
					return sendJson(res, 200, orch.agentHistory(ref, num(q.get('limit'), 400)))
				if (m === 'POST' && seg[2] === 'send') {
					const body = await readBody(req)
					return sendJson(res, 200, await orch.send(ref, parseSendRequest(body)))
				}
				if (m === 'POST' && seg[2] === 'cancel')
					return sendJson(res, 200, await orch.cancelAgent(ref))
				if (m === 'POST' && seg[2] === 'permission' && seg[3]) {
					const body = await readBody(req)
					const approve = isObject(body) && body['approve'] === false ? false : true
					const ok = await orch.resolvePermission(ref, seg[3], approve)
					return sendJson(res, ok ? 200 : 404, { ok })
				}
			}
		}

		// ---------- сообщения ----------
		if (m === 'GET' && p === '/messages') {
			const since = q.get('since')
			return sendJson(
				res,
				200,
				orch.listMessages({
					agent: q.get('agent') ?? undefined,
					since: since === null ? undefined : num(since, 0),
					limit: num(q.get('limit'), 200),
				}),
			)
		}
		if (m === 'GET' && p === '/inbox') {
			const after = q.get('after')
			return sendJson(
				res,
				200,
				await orch.inbox({
					wait: num(q.get('wait'), 0),
					peek: q.get('peek') === '1',
					after: after === null ? undefined : num(after, 0),
				}),
			)
		}

		throw new HttpError(404, 'not_found', `${m} ${p}`)
	}

	// ======================================================================
	// SSE
	// ======================================================================
	/** Открыть SSE-ответ; очистка выполняется при закрытии соединения клиентом. */
	function openSse(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		...cleanup: Array<() => void>
	): void {
		res.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		res.write(": connected\n\n");
		const hb = setInterval(() => res.write(": hb\n\n"), 15000);
		req.on("close", () => {
			clearInterval(hb);
			for (const fn of cleanup) fn();
		});
	}

	function streamAll(req: http.IncomingMessage, res: http.ServerResponse): void {
		// сначала подписка (чтобы не потерять события), затем снапшот
		const unsub = orch.hub.subscribe(evt => {
			if (evt.t === 'event' || evt.t === 'chunk') return // чат агента — отдельным потоком
			res.write(formatFrame(evt satisfies StreamEvent, { id: evt.rev }))
		})
		openSse(req, res, unsub)
		res.write(formatFrame(orch.snapshot(), { id: orch.hub.rev }))
	}

	function streamAgent(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		ref: string,
	): void {
		const agent = orch.resolveAgent(ref)
		const send = (e: AgentStreamEvent): void => {
			res.write(formatFrame(e))
		}
		const unsub = orch.hub.subscribe(evt => {
			if (evt.t === 'event' && evt.agentId === agent.id) send({ t: 'event', event: evt.event })
			else if (evt.t === 'chunk' && evt.agentId === agent.id) send({ t: 'chunk', chunk: evt.chunk })
			else if (evt.t === 'agent' && evt.agent.id === agent.id) send({ t: 'agent', agent: evt.agent })
		})
		openSse(req, res, unsub)
		for (const e of orch.agentHistory(agent.id, 400)) send({ t: 'event', event: e })
		send({ t: 'agent', agent: agent.toJSON() })
		send({ t: 'replay_done' })
	}

	return server
}

// ======================================================================
// helpers
// ======================================================================
function isApiPath(first: string | undefined): boolean {
	return (
		first === 'health' ||
		first === 'status' ||
		first === 'graph' ||
		first === 'stream' ||
		first === 'spaces' ||
		first === 'agents' ||
		first === 'messages' ||
		first === 'inbox'
	)
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
	const s = JSON.stringify(body)
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': Buffer.byteLength(s),
		'Cache-Control': 'no-store',
	})
	res.end(s)
}

function serveStatic(res: http.ServerResponse, urlPath: string, root: string): void {
	const rel = urlPath === '/' ? '/index.html' : urlPath
	const file = path.normalize(path.join(root, rel))
	if (!file.startsWith(root + path.sep) && file !== root)
		throw new HttpError(403, 'forbidden', 'вне каталога UI')
	let data: Buffer
	try {
		data = fs.readFileSync(file)
	} catch {
		throw new HttpError(
			404,
			'not_found',
			fs.existsSync(root) ? rel : 'UI не найден (ожидается собранный UI в ' + root + ', см. ui/README.md)',
		)
	}
	res.writeHead(200, {
		'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
		'Cache-Control': 'no-store',
	})
	res.end(data)
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let size = 0
		const chunks: Buffer[] = []
		req.on('data', (c: Buffer) => {
			size += c.length
			if (size > MAX_BODY) {
				reject(new HttpError(413, 'too_large', 'тело запроса слишком большое'))
				req.destroy()
				return
			}
			chunks.push(c)
		})
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8')
			if (!raw) return resolve({})
			const v = parseJson(raw)
			if (v === undefined) return reject(new HttpError(400, 'bad_json', 'тело запроса — не JSON'))
			resolve(v)
		})
		req.on('error', reject)
	})
}

const num = (v: string | null, d: number): number => {
	const n = Number(v)
	return v !== null && Number.isFinite(n) ? n : d
}

const optStr = (v: unknown): string | undefined =>
	typeof v === 'string' && v !== '' ? v : undefined
const optNum = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined

function parseSpaceRequest(b: unknown): SpaceRequest {
	if (!isObject(b) || typeof b['path'] !== 'string')
		throw new HttpError(400, 'bad_request', 'нужно поле path (строка)')
	return { path: b['path'], name: optStr(b['name']), url: optStr(b['url']) }
}

function parseSpawnRequest(b: unknown): SpawnRequest {
	if (!isObject(b)) throw new HttpError(400, 'bad_request', 'ожидается JSON-объект')
	return {
		space: optStr(b['space']),
		name: optStr(b['name']),
		prompt: optStr(b['prompt']),
		parent: optStr(b['parent']),
		from: optStr(b['from']),
		wait: b['wait'] === true,
		waitTimeoutSec: optNum(b['waitTimeoutSec']),
	}
}

function parseSendRequest(b: unknown): SendRequest {
	if (!isObject(b) || typeof b['text'] !== 'string')
		throw new HttpError(400, 'bad_request', 'нужно поле text (строка)')
	return {
		text: b['text'],
		from: optStr(b['from']),
		wait: b['wait'] === true,
		waitTimeoutSec: optNum(b['waitTimeoutSec']),
	}
}
