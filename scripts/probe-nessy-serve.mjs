#!/usr/bin/env node
/**
 * Пробы живого `nessy serve`: снимает то, чего нет в документации (формат tool_call/plan, stats, mid-turn-message, detach, гонки
 * restore, reaper, лимит сессий). Сам поднимает демоны на 127.0.0.1:4391–4393 во временных каталогах и гасит их в конце.
 * Запуск:  NESSY_BIN=/путь/к/nessy node scripts/probe-nessy-serve.mjs        (по умолчанию `nessy` из PATH)
 * Результат: nessy-probe-report.md в текущем каталоге — его и присылайте. Делает ~10 коротких запросов к модели.
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const BIN = process.env.NESSY_BIN || 'nessy'
const REPORT = path.resolve('nessy-probe-report.md')
const out = ['# Пробы nessy serve\n', `Дата: ${new Date().toISOString()}\n`]
const daemons = []

const clip = (s, n = 2500) => (s.length > n ? s.slice(0, n) + `… (+${s.length - n} знаков)` : s)
const show = v => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))
const log = (title, data) => {
	out.push(`\n## ${title}\n\n\`\`\`\n${clip(show(data))}\n\`\`\`\n`)
	console.log('•', title)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function startDaemon(port, extra = []) {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'nessy-probe-'))
	const proc = spawn(BIN, ['serve', '--port', String(port), '--hostname', '127.0.0.1', '--workspace', ws, '--no-web', ...extra], { stdio: ['ignore', 'pipe', 'pipe'] })
	let logText = ''
	proc.stdout.on('data', d => (logText += d))
	proc.stderr.on('data', d => (logText += d))
	const d = { port, ws, proc, base: `http://127.0.0.1:${port}`, log: () => logText }
	daemons.push(d)
	for (let i = 0; i < 60; i++) {
		try {
			if ((await fetch(d.base + '/health')).ok) return d
		} catch { /* ещё не поднялся */ }
		await sleep(500)
	}
	throw new Error('демон не поднялся:\n' + clip(logText))
}

async function call(d, method, p, body, headers = {}) {
	const r = await fetch(d.base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
	const text = await r.text()
	let json = null
	try { json = JSON.parse(text) } catch { /* не JSON */ }
	return { status: r.status, retryAfter: r.headers.get('retry-after'), body: json ?? clip(text, 800) }
}

/** SSE-подписка: копит кадры {id,event,data,at}; stop() закрывает. */
function subscribe(d, sid, lastId = null) {
	const events = []
	const ac = new AbortController()
	const headers = { accept: 'text/event-stream' }
	if (lastId !== null) headers['last-event-id'] = String(lastId)
	const done = (async () => {
		try {
			const r = await fetch(`${d.base}/session/${sid}/events`, { headers, signal: ac.signal })
			if (r.status !== 200) { events.push({ event: `HTTP ${r.status}`, data: await r.text() }); return }
			const reader = r.body.getReader()
			const dec = new TextDecoder()
			let buf = ''
			for (;;) {
				const { value, done: end } = await reader.read()
				if (end) break
				buf += dec.decode(value, { stream: true })
				let i
				while ((i = buf.indexOf('\n\n')) >= 0) {
					const raw = buf.slice(0, i)
					buf = buf.slice(i + 2)
					const f = { at: Date.now() }
					for (const line of raw.split('\n')) {
						if (line.startsWith('id:')) f.id = Number(line.slice(3).trim())
						else if (line.startsWith('event:')) f.event = line.slice(6).trim()
						else if (line.startsWith('data:')) f.data = (f.data ?? '') + line.slice(5).trim()
					}
					if (f.event) { try { f.json = JSON.parse(f.data) } catch { /* не JSON */ } events.push(f) }
				}
			}
		} catch { /* abort */ }
	})()
	return { events, stop: () => ac.abort(), done }
}

const TERMINAL = new Set(['turn_complete', 'turn_error', 'prompt_cancelled'])
async function waitTerminal(sub, from, timeoutMs = 120000) {
	const t0 = Date.now()
	while (Date.now() - t0 < timeoutMs) {
		if (sub.events.slice(from).some(e => TERMINAL.has(e.event))) return true
		await sleep(300)
	}
	return false
}

/** Голосует за permission_request (allow_once), пока подписка жива. */
function autoVote(d, sid, sub) {
	let seen = 0
	const timer = setInterval(async () => {
		for (; seen < sub.events.length; seen++) {
			const e = sub.events[seen]
			if (e.event !== 'permission_request') continue
			const opt = (e.json?.data?.options ?? e.json?.options ?? []).find(o => o.kind === 'allow_once') ?? (e.json?.data?.options ?? e.json?.options ?? [])[0]
			const rid = e.json?.data?.requestId ?? e.json?.requestId
			if (rid && opt) await call(d, 'POST', `/session/${sid}/permission/${rid}`, { outcome: { outcome: 'selected', optionId: opt.optionId } }).catch(() => undefined)
		}
	}, 300)
	return () => clearInterval(timer)
}

const textOf = (events, from = 0) =>
	events.slice(from).filter(e => e.event === 'session_update' && (e.json?.data?.sessionUpdate ?? e.json?.sessionUpdate) === 'agent_message_chunk')
		.map(e => (e.json?.data ?? e.json)?.content?.text ?? '').join('')

const prompt = (d, sid, text) => call(d, 'POST', `/session/${sid}/prompt`, { prompt: [{ type: 'text', text }] })
const types = events => events.map(e => e.event + (e.id !== undefined ? `#${e.id}` : '')).join(' ')

async function probe(name, fn) {
	try { await fn() } catch (e) { log(`${name} — ОШИБКА ПРОБЫ`, String(e?.stack ?? e)) }
}

async function main() {
	log('Окружение', { bin: BIN, node: process.version })
	const d = await startDaemon(4391)
	log('Запуск демона (вывод)', d.log())

	await probe('capabilities', async () => {
		const r = await call(d, 'GET', '/capabilities')
		log('GET /capabilities', r)
		log('GET /daemon/status?detail=summary', await call(d, 'GET', '/daemon/status?detail=summary'))
		log('GET /health?deep=1', await call(d, 'GET', '/health?deep=1'))
		log('POST /session с чужим cwd (workspace_mismatch?)', await call(d, 'POST', '/session', { cwd: '/tmp', sessionScope: 'thread' }))
	})

	let sid = null
	let sub = null
	await probe('простой ход', async () => {
		const c = await call(d, 'POST', '/session', { cwd: d.ws, sessionScope: 'thread' })
		log('POST /session', c)
		sid = c.body.sessionId
		sub = subscribe(d, sid, 0)
		await sleep(500)
		log('GET /session/:id/context (approval mode по умолчанию, модель)', await call(d, 'GET', `/session/${sid}/context`))
		const t = await prompt(d, sid, 'Запомни число 4217. Ответь одним словом: ok')
		log('POST /prompt (статус и тело)', t)
		await waitTerminal(sub, 0)
		log('Последовательность событий хода', types(sub.events))
		log('Первый кадр каждого вида session_update', (() => {
			const seen = new Map()
			for (const e of sub.events) {
				const k = e.event === 'session_update' ? (e.json?.data?.sessionUpdate ?? e.json?.sessionUpdate) : e.event
				if (!seen.has(k)) seen.set(k, e.data)
			}
			return Object.fromEntries(seen)
		})())
		log('GET /session/:id/stats', await call(d, 'GET', `/session/${sid}/stats`))
		log('GET /session/:id/context-usage', await call(d, 'GET', `/session/${sid}/context-usage?detail=true`))
		log('GET /workspace/:id/sessions', await call(d, 'GET', `/workspace/${encodeURIComponent(d.ws)}/sessions`))
	})

	await probe('инструменты и план', async () => {
		if (!sid) return
		const stopVote = autoVote(d, sid, sub)
		const from = sub.events.length
		await prompt(d, sid, 'Создай в текущем каталоге файл note.txt с текстом hello. Перед работой запиши план из 2 пунктов (инструмент планирования, если он есть), затем выполни его.')
		await waitTerminal(sub, from, 150000)
		stopVote()
		const slice = sub.events.slice(from)
		log('События (виды)', types(slice))
		const pick = k => slice.find(e => e.event === 'session_update' && (e.json?.data?.sessionUpdate ?? e.json?.sessionUpdate) === k)?.data
		log('Образцы кадров', { tool_call: pick('tool_call'), tool_call_update: pick('tool_call_update'), plan: pick('plan'), permission_request: slice.find(e => e.event === 'permission_request')?.data })
	})

	await probe('mid-turn-message', async () => {
		if (!sid) return
		log('mid-turn-message в простое', await call(d, 'POST', `/session/${sid}/mid-turn-message`, { message: 'тест в простое' }))
		const from = sub.events.length
		const stopVote = autoVote(d, sid, sub)
		await prompt(d, sid, 'Выполни в shell: for i in 1 2 3 4 5 6; do echo $i; sleep 2; done. Потом напиши слово «готово».')
		await sleep(5000)
		log('mid-turn-message посреди хода', await call(d, 'POST', `/session/${sid}/mid-turn-message`, { message: 'Добавь в самый конец ответа слово БАНАН.' }))
		await waitTerminal(sub, from, 150000)
		stopVote()
		log('Виды событий хода', types(sub.events.slice(from)))
		log('Итоговый текст ответа (есть ли БАНАН?)', textOf(sub.events, from))
	})

	await probe('cancel и очередь', async () => {
		if (!sid) return
		const from = sub.events.length
		const stopVote = autoVote(d, sid, sub)
		await prompt(d, sid, 'Выполни в shell: sleep 20, затем напиши «A».')
		const b = await prompt(d, sid, 'Напиши слово «B».')
		log('второй промпт в очередь', b)
		await sleep(3000)
		log('POST /cancel', await call(d, 'POST', `/session/${sid}/cancel`, {}))
		await sleep(15000)
		stopVote()
		log('Что пришло после cancel (кадры по порядку)', types(sub.events.slice(from)))
		log('Выполнился ли промпт «B» из очереди (текст)', textOf(sub.events, from))
	})

	await probe('detach', async () => {
		if (!sid) return
		log('POST /session/:id/detach', await call(d, 'POST', `/session/${sid}/detach`, {}))
	})

	await probe('DELETE → resume', async () => {
		if (!sid) return
		sub.stop()
		log('DELETE', await call(d, 'DELETE', `/session/${sid}`))
		log('повторный DELETE', await call(d, 'DELETE', `/session/${sid}`))
		log('список сессий после DELETE', await call(d, 'GET', `/workspace/${encodeURIComponent(d.ws)}/sessions`))
		log('prompt в закрытую сессию без восстановления', await prompt(d, sid, 'ping'))
		const r = await call(d, 'POST', `/session/${sid}/resume`, {})
		log('POST /resume (ключи ответа и lastEventId)', { status: r.status, keys: r.body && typeof r.body === 'object' ? Object.keys(r.body) : null, lastEventId: r.body?.lastEventId, attached: r.body?.attached, state: r.body?.state?.modes })
		const s2 = subscribe(d, sid, r.body?.lastEventId ?? null)
		await sleep(1500)
		log('после resume с Last-Event-ID=lastEventId (повтор истории?)', types(s2.events))
		const stopVote = autoVote(d, sid, s2)
		await prompt(d, sid, 'Какое число я просил запомнить? Ответь только числом.')
		await waitTerminal(s2, 0)
		stopVote()
		log('Помнит ли модель число (ждём 4217)', textOf(s2.events))
		log('кадры хода после resume', types(s2.events))
		s2.stop()
	})

	await probe('DELETE → load, гонка load + prompt', async () => {
		if (!sid) return
		await call(d, 'DELETE', `/session/${sid}`)
		const [l, p] = await Promise.all([call(d, 'POST', `/session/${sid}/load`, {}), prompt(d, sid, 'Напиши «2+2=4»').catch(e => ({ error: String(e) }))])
		log('параллельно load и prompt на холодной сессии', { load: { status: l.status, keys: l.body && typeof l.body === 'object' ? Object.keys(l.body) : l.body, lastEventId: l.body?.lastEventId, attached: l.body?.attached }, prompt: p })
		const s3 = subscribe(d, sid, 0)
		await sleep(3000)
		log('подписка после load с Last-Event-ID:0 (replay_complete?)', types(s3.events).slice(0, 1500))
		s3.stop()
	})

	d.proc.kill('SIGTERM')

	await probe('лимит сессий', async () => {
		const d2 = await startDaemon(4392, ['--max-sessions', '2'])
		const a = await call(d2, 'POST', '/session', { cwd: d2.ws, sessionScope: 'thread' })
		const b = await call(d2, 'POST', '/session', { cwd: d2.ws, sessionScope: 'thread' })
		const c = await call(d2, 'POST', '/session', { cwd: d2.ws, sessionScope: 'thread' })
		log('3-я сессия при --max-sessions 2', { c })
		await call(d2, 'DELETE', `/session/${a.body.sessionId}`)
		log('после DELETE одной', await call(d2, 'POST', '/session', { cwd: d2.ws, sessionScope: 'thread' }))
		log('/daemon/status', await call(d2, 'GET', '/daemon/status?detail=summary'))
		d2.proc.kill('SIGTERM')
		void b
	})

	await probe('reaper', async () => {
		const d3 = await startDaemon(4393, ['--session-idle-timeout-ms', '15000', '--session-reap-interval-ms', '3000'])
		const free = (await call(d3, 'POST', '/session', { cwd: d3.ws, sessionScope: 'thread' })).body.sessionId
		const watched = (await call(d3, 'POST', '/session', { cwd: d3.ws, sessionScope: 'thread' })).body.sessionId
		const s = subscribe(d3, watched, 0)
		await sleep(35000)
		log('через 35 с при idle 15 с: без подписчика / с подписчиком SSE', {
			без_подписчика: (await call(d3, 'GET', `/session/${free}/context`)).status,
			с_подписчиком: (await call(d3, 'GET', `/session/${watched}/context`)).status,
			события_подписчика: types(s.events),
		})
		s.stop()
		d3.proc.kill('SIGTERM')
	})
}

try {
	await main()
} catch (e) {
	log('Фатальная ошибка', String(e?.stack ?? e))
} finally {
	for (const d of daemons) d.proc.kill('SIGTERM')
	fs.writeFileSync(REPORT, out.join(''))
	console.log('\nОтчёт:', REPORT)
	setTimeout(() => process.exit(0), 500)
}
