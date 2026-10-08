#!/usr/bin/env node
/**
 * fake-nessy — имитация `nessy serve` для тестов и демо (без модели и без сети).
 * Повторяет проверенный контракт: /health, POST /session (независимые сессии), POST /prompt,
 * GET /events (SSE с Last-Event-ID), cancel, permission, DELETE.
 *
 * Поведение агента по тексту промпта (последняя строка, без вводной оркестратора):
 *   «#shell …»        → вызов инструмента run_shell_command (+ запрос разрешения при «#perm»)
 *   «#slow»           → долгий ответ (1.5 с), можно прервать cancel
 *   «#fail»           → завершить сессию аварийно (session_died)
 *   «#relay <кому> <текст>» → выполнить shell `nessy-orch send ...` (как это сделал бы реальный агент)
 *   иначе             → эхо: «ответ: <текст>»
 */
import * as http from 'node:http'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

interface Frame {
	id: number
	event: string
	data: string
}
interface Session {
	id: string
	seq: number
	ring: Frame[]
	subs: Set<http.ServerResponse>
	cancelled: boolean
	timers: NodeJS.Timeout[]
}

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
	const i = argv.indexOf(name)
	return i === -1 ? undefined : argv[i + 1]
}
if (argv[0] !== 'serve') {
	console.error('fake-nessy: поддерживается только `serve`')
	process.exit(2)
}
const port = parseInt(flag('--port') ?? '0', 10)
const workspace = flag('--workspace') ?? process.cwd()
const sessions = new Map<string, Session>()
const delay = parseInt(process.env['FAKE_NESSY_DELAY_MS'] ?? '20', 10)

function emit(s: Session, event: string, payload: Record<string, unknown>): void {
	const id = ++s.seq
	const data = JSON.stringify({ id, v: 1, type: event, data: { sessionId: s.id, ...payload } })
	const f: Frame = { id, event, data }
	s.ring.push(f)
	for (const r of s.subs) write(r, f)
}
const write = (r: http.ServerResponse, f: Frame): void => {
	r.write(`id: ${f.id}\nevent: ${f.event}\ndata: ${f.data}\n\n`)
}
const update = (s: Session, u: Record<string, unknown>): void => emit(s, 'session_update', { update: u })
const later = (s: Session, ms: number, fn: () => void): void => {
	s.timers.push(setTimeout(fn, ms))
}

function runPrompt(s: Session, promptId: string, text: string): void {
	s.cancelled = false
	const body = text.split('\n').filter(Boolean).pop() ?? ''
	update(s, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } })
	let t = delay

	const finish = (reason: string): void => {
		emit(s, 'turn_complete', { stopReason: reason, promptId })
		if (!sessions.get(s.id)?.ring.some(f => f.event === 'session_metadata_updated')) {
			emit(s, 'session_metadata_updated', { displayName: body.slice(0, 40), titleSource: 'auto' })
		}
	}
	const say = (str: string): void => {
		for (const part of str.match(/.{1,12}/gs) ?? []) {
			later(s, (t += delay), () => {
				if (!s.cancelled) update(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: part } })
			})
		}
	}
	const think = (str: string): void => {
		later(s, (t += delay), () => update(s, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: str } }))
	}

	if (body.startsWith('#fail')) {
		later(s, t, () => {
			emit(s, 'session_died', {})
			for (const r of s.subs) r.end()
			sessions.delete(s.id)
		})
		return
	}
	if (body.startsWith('#slow')) {
		think('думаю долго…')
		say('медленный ответ')
		later(s, (t += 1500), () => finish(s.cancelled ? 'cancelled' : 'end_turn'))
		return
	}
	if (body.startsWith('#shell') || body.startsWith('#perm') || body.startsWith('#relay')) {
		const toolId = 'call_' + randomUUID().slice(0, 8)
		const cmd = body.startsWith('#relay')
			? `${process.env['FAKE_NESSY_CLI'] ?? 'nessy-orch'} send ${body.replace(/^#relay\s+/, '')}`
			: body.replace(/^#(shell|perm)\s*/, '') || 'echo ok'
		think('нужно выполнить команду')
		if (body.startsWith('#perm')) {
			later(s, (t += delay), () =>
				emit(s, 'permission_request', {
					requestId: 'perm_' + toolId,
					toolCall: { title: `Shell: ${cmd}`, _meta: { toolName: 'run_shell_command' } },
					options: [
						{ optionId: 'allow_once', kind: 'allow_once', name: 'Разрешить' },
						{ optionId: 'reject_once', kind: 'reject_once', name: 'Отклонить' },
					],
				}),
			)
			t += delay * 3
		}
		later(s, (t += delay), () =>
			update(s, {
				sessionUpdate: 'tool_call',
				toolCallId: toolId,
				kind: 'execute',
				status: 'in_progress',
				title: `Shell: ${cmd}`,
				rawInput: { command: cmd },
				_meta: { toolName: 'run_shell_command' },
			}),
		)
		const runs = body.startsWith('#relay')
		later(s, (t += delay), () => {
			const done = (out: string): void => {
				update(s, { sessionUpdate: 'tool_call_update', toolCallId: toolId, status: 'completed', rawOutput: out, _meta: { toolName: 'run_shell_command' } })
				say(`выполнено: ${out.trim().slice(0, 80)}`)
				later(s, (t += delay * 12), () => finish('end_turn'))
			}
			if (!runs) return done(`вывод команды: ${cmd}`)
			const p = spawn('/bin/sh', ['-c', cmd], { env: process.env })
			let buf = ''
			p.stdout.on('data', (d: Buffer) => (buf += d.toString()))
			p.stderr.on('data', (d: Buffer) => (buf += d.toString()))
			p.on('close', () => {
				t = 0
				done(buf || '(пусто)')
			})
		})
		return
	}
	think('обдумываю запрос')
	say(`ответ: ${body}`)
	later(s, (t += delay * 2), () => finish('end_turn'))
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise(resolve => {
		let d = ''
		req.on('data', (c: Buffer) => (d += c.toString()))
		req.on('end', () => {
			try {
				const v: unknown = JSON.parse(d || '{}')
				resolve(typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})
			} catch {
				resolve({})
			}
		})
	})
}
const json = (res: http.ServerResponse, code: number, body: unknown): void => {
	res.writeHead(code, { 'Content-Type': 'application/json' })
	res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
	void (async () => {
		const url = new URL(req.url ?? '/', 'http://x')
		const seg = url.pathname.split('/').filter(Boolean)
		if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: 'ok' })
		if (req.method === 'POST' && url.pathname === '/session') {
			const b = await readJson(req)
			if (typeof b['cwd'] === 'string' && b['cwd'] !== workspace) return json(res, 400, { code: 'workspace_mismatch', error: 'workspace mismatch' })
			const s: Session = { id: randomUUID(), seq: 0, ring: [], subs: new Set(), cancelled: false, timers: [] }
			sessions.set(s.id, s)
			return json(res, 200, { sessionId: s.id, workspaceCwd: workspace, attached: false })
		}
		const s = seg[0] === 'session' && seg[1] ? sessions.get(seg[1]) : undefined
		if (seg[0] === 'session' && !s) return json(res, 404, { error: 'session not found' })
		if (s && req.method === 'GET' && seg[2] === 'events') {
			res.writeHead(200, { 'Content-Type': 'text/event-stream' })
			const last = parseInt(String(req.headers['last-event-id'] ?? '0'), 10) || 0
			for (const f of s.ring) if (f.id > last) write(res, f)
			s.subs.add(res)
			req.on('close', () => s.subs.delete(res))
			return
		}
		if (s && req.method === 'POST' && seg[2] === 'prompt') {
			const b = await readJson(req)
			const parts = Array.isArray(b['prompt']) ? (b['prompt'] as Array<Record<string, unknown>>) : []
			const text = parts.map(p => (typeof p['text'] === 'string' ? p['text'] : '')).join('\n')
			const promptId = randomUUID()
			json(res, 200, { promptId, lastEventId: s.seq })
			runPrompt(s, promptId, text)
			return
		}
		if (s && req.method === 'POST' && seg[2] === 'cancel') {
			s.cancelled = true
			return json(res, 200, {})
		}
		if (s && req.method === 'POST' && seg[2] === 'permission') return json(res, 200, { ok: true })
		if (s && req.method === 'POST' && seg[2] === 'load') return json(res, 200, {})
		if (s && req.method === 'DELETE') {
			for (const t of s.timers) clearTimeout(t)
			for (const r of s.subs) r.end()
			sessions.delete(s.id)
			return json(res, 200, {})
		}
		json(res, 404, { error: 'not found' })
	})()
})
server.listen(port, '127.0.0.1', () => console.log(`fake-nessy listening on ${port} workspace=${workspace}`))
process.on('SIGTERM', () => process.exit(0))
// Если родитель (оркестратор/тест) исчез или не смог послать сигнал — не оставаться сиротой.
const parentPid = process.ppid
setInterval(() => {
	if (process.ppid !== parentPid) process.exit(0)
}, 500).unref()
