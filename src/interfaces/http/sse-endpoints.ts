/** SSE-потоки: общий `/stream` и чат одного агента `/agents/:ref/stream`. */
import type * as http from 'node:http'
import type { AgentStreamEvent, StreamEvent } from '../../../shared/types'
import type { Orchestrator } from '../../application/orchestrator'
import { formatFrame } from '../../infrastructure/sse/sse-format'

const HEARTBEAT_MS = 15000

/** Открыть SSE-ответ; очистка выполняется при закрытии соединения клиентом. */
function openSse(req: http.IncomingMessage, res: http.ServerResponse, cleanup: () => void): void {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	})
	res.write(': connected\n\n')
	const hb = setInterval(() => res.write(': hb\n\n'), HEARTBEAT_MS)
	hb.unref()
	req.on('close', () => {
		clearInterval(hb)
		cleanup()
	})
}

export function streamAll(orch: Orchestrator, req: http.IncomingMessage, res: http.ServerResponse): void {
	// сначала подписка (чтобы не потерять события), затем снапшот
	const unsub = orch.hub.subscribe(evt => {
		if (evt.t === 'event' || evt.t === 'chunk') return // чат агента — отдельным потоком
		res.write(formatFrame(evt satisfies StreamEvent, { id: evt.rev }))
	})
	openSse(req, res, unsub)
	res.write(formatFrame(orch.snapshot(), { id: orch.hub.rev }))
}

/**
 * Поток агента: история (без незавершённого блока) → незавершённый блок одним chunk
 * (delta = весь накопленный текст) → текущее состояние агента → replay_done → живые события.
 */
export function streamAgent(orch: Orchestrator, req: http.IncomingMessage, res: http.ServerResponse, ref: string): void {
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
	for (const e of orch.agentHistory(agent.id, 400, false)) send({ t: 'event', event: e })
	const live = agent.liveRun()
	if (live) send({ t: 'chunk', chunk: { seq: live.seq, ts: live.ts, kind: live.kind, delta: live.text, len: live.text.length } })
	send({ t: 'agent', agent: agent.toJSON() })
	send({ t: 'replay_done' })
}
