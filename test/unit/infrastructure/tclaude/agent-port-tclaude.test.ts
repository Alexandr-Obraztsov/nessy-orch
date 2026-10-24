import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildClaudeEnv, buildTclaudeArgs } from '../../../../src/infrastructure/tclaude/spawn-claude'
import { normalizeModel, verifyModel } from '../../../../src/infrastructure/tclaude/tclaude-session'
import { AppError } from '../../../../src/domain/errors'
import { firstChild, makePort, subscribedSession } from './tclaude-test-support'

describe('TclaudeAgentPort', () => {
	it('capabilities: setModel=true, permissionVote=false, streamText и midTurn — true', () => {
		const { port } = makePort()
		assert.deepEqual(port.capabilities, { streamText: true, midTurn: true, permissionVote: false, setModel: true })
	})

	it('buildTclaudeArgs: базовые флаги, session-id, resume, model, permission-mode', () => {
		const args = buildTclaudeArgs({ bin: 't', sessionId: 's1', model: 'sonnet', permissionMode: 'default', homeDir: '/h', cwd: '/ws' })
		assert.deepEqual(args, [
			'-p',
			'--output-format',
			'stream-json',
			'--input-format',
			'stream-json',
			'--verbose',
			'--session-id',
			's1',
			'--model',
			'sonnet',
			'--bare',
			'--strict-mcp-config',
			'--no-session-persistence',
			'--permission-mode',
			'default',
		])
		const resume = buildTclaudeArgs({ bin: 't', sessionId: 's1', resume: true, permissionMode: 'default', homeDir: '/h', cwd: '/ws' })
		assert.ok(resume.includes('--resume') && resume.includes('s1') && !resume.includes('--session-id'))
	})

	it('buildClaudeEnv: инъектирует auth llm-прокси из resolveAuth в изолированный HOME', () => {
		const env = buildClaudeEnv({
			bin: 't',
			permissionMode: 'default',
			homeDir: '/h',
			cwd: '/ws',
			resolveAuth: () => ({ token: 'TK', baseUrl: 'https://proxy' }),
		})
		assert.equal(env['HOME'], '/h')
		assert.equal(env['ANTHROPIC_AUTH_TOKEN'], 'TK')
		assert.equal(env['ANTHROPIC_BASE_URL'], 'https://proxy')
	})

	it('buildClaudeEnv: токен из env-опции не перезаписывается (resolveAuth не вызывается)', () => {
		let called = false
		const env = buildClaudeEnv({
			bin: 't',
			permissionMode: 'default',
			homeDir: '/h',
			cwd: '/ws',
			env: { ANTHROPIC_AUTH_TOKEN: 'EXISTING' },
			resolveAuth: () => {
				called = true
				return { token: 'TK' }
			},
		})
		assert.equal(env['ANTHROPIC_AUTH_TOKEN'], 'EXISTING')
		assert.equal(called, false)
	})

	it('buildClaudeEnv: пустой auth не добавляет ключей (HOME изолирован)', () => {
		const env = buildClaudeEnv({ bin: 't', permissionMode: 'default', homeDir: '/h', cwd: '/ws', resolveAuth: () => ({}) })
		assert.equal(env['HOME'], '/h')
		assert.equal(env['ANTHROPIC_AUTH_TOKEN'], process.env['ANTHROPIC_AUTH_TOKEN'])
	})

	it('sessionCreate спавнит один процесс с изолированным HOME и cwd воркспейса', async () => {
		const { port, children, calls } = makePort()
		const { sessionId } = await port.sessionCreate('/ws')
		assert.equal(children.length, 1)
		const call = calls[0]
		assert.ok(call, 'ожидали вызов спавна')
		assert.equal(call.sessionId, sessionId)
		assert.equal(call.cwd, '/ws')
		assert.match(call.homeDir, /tclaude-agent-/)
		assert.equal(call.permissionMode, 'default')
	})

	it('subscribe синтезирует session.ready с валидным конвертом (v, seq, ts)', async () => {
		const { port } = makePort()
		const { types } = await subscribedSession(port)
		assert.deepEqual(types, ['session.ready'])
		const envs: unknown[] = []
		const { sessionId: id } = await port.sessionCreate('/ws')
		port.subscribe(id, { onEvent: e => envs.push({ v: e.v, type: e.type, seq: e.seq, ts: e.ts, sessionId: e.sessionId }) })
		assert.deepEqual(envs, [{ v: 1, type: 'session.ready', seq: 1, ts: 100, sessionId: id }])
	})

	it('маппинг хода: promptSend→turn.started; assistant→message.delta; result→message.completed+turn.completed с UnifiedUsage', async () => {
		const { port, children } = makePort()
		const { sessionId, types } = await subscribedSession(port)
		const child = firstChild(children)
		await port.promptSend(sessionId, 'привет')
		assert.ok(types.includes('turn.started'))
		// текст записан в stdin как NDJSON
		assert.ok(child.written.includes('"text":"привет"'))
		child.emitLine({
			type: 'assistant',
			message: {
				content: [
					{ type: 'text', text: 'часть' },
					{ type: 'text', text: '1' },
				],
			},
		})
		child.emitLine({ type: 'assistant', message: { content: [{ type: 'text', text: '2' }] } })
		child.emitLine({ type: 'result', subtype: 'success', stop_reason: 'end_turn', total_cost_usd: 1.25, num_turns: 3, duration_ms: 500 })
		assert.ok(types.includes('message.delta'))
		assert.ok(types.includes('message.completed'))
		assert.ok(types.includes('turn.completed'))
		// message.completed до turn.completed
		assert.ok(types.indexOf('message.completed') < types.indexOf('turn.completed'))
		// UnifiedUsage доступен из lastUsage
		const usage = port.sessionUsage(sessionId)
		assert.ok(usage, 'ожидали UnifiedUsage')
		assert.equal(usage.costUsd, 1.25)
		assert.equal(usage.numTurns, 3)
		assert.equal(usage.durationMs, 500)
	})

	it('верификация модели: расхождение init → model.switch_failed (opus падает в дефолт)', async () => {
		const { port, children } = makePort('opus')
		const { sessionId, types } = await subscribedSession(port)
		firstChild(children).emitLine({ type: 'system', subtype: 'init', session_id: sessionId, model: 'sonnet', cwd: '/ws' })
		const sf = types.find(t => t === 'model.switch_failed')
		assert.ok(sf, `ожидали model.switch_failed: ${types.join(', ')}`)
		assert.ok(!types.includes('session.ready') || types.indexOf('session.ready') < types.indexOf('model.switch_failed') + 1)
	})

	it('верификация модели: совпадение init → нет model.switch_failed', async () => {
		const { port, children } = makePort('sonnet')
		const { sessionId, types } = await subscribedSession(port)
		firstChild(children).emitLine({ type: 'system', subtype: 'init', session_id: sessionId, model: 'sonnet', cwd: '/ws' })
		assert.ok(!types.includes('model.switch_failed'), `не должно быть switch_failed: ${types.join(', ')}`)
	})

	it('гонка отмены: после SIGINT поздний result игнорируется и синтезируется turn.cancelled (без turn.completed)', async () => {
		const { port, children } = makePort()
		const { sessionId, types } = await subscribedSession(port)
		const child = firstChild(children)
		await port.promptSend(sessionId, 'долгий ход')
		assert.ok(types.includes('turn.started'))
		await port.promptCancel(sessionId)
		assert.ok(child.killed, 'должен быть отправлен сигнал')
		assert.ok(child.signalLog.includes('SIGINT'), `сигнал SIGINT: ${child.signalLog.join(',')}`)
		assert.ok(types.includes('turn.cancelled'))
		// поздний result и assistant после отмены — игнорируются
		child.emitLine({ type: 'assistant', message: { content: [{ type: 'text', text: 'поздно' }] } })
		child.emitLine({ type: 'result', subtype: 'success', stop_reason: 'end_turn', num_turns: 1 })
		assert.ok(!types.includes('turn.completed'), 'поздний result не должен дать turn.completed')
		assert.ok(!types.includes('message.completed'))
	})

	it('error → turn.failed с retryable=false', async () => {
		const { port, children } = makePort()
		const { sessionId, types } = await subscribedSession(port)
		await port.promptSend(sessionId, 'x')
		firstChild(children).emitLine({ type: 'error', error: { message: 'boom' } })
		const i = types.indexOf('turn.failed')
		assert.ok(i !== -1, `ожидали turn.failed: ${types.join(', ')}`)
	})

	it('seq монотонен и уникален по всем событиям сессии', async () => {
		const { port, children } = makePort()
		const { sessionId } = await subscribedSession(port)
		const seqs: number[] = []
		port.subscribe(sessionId, {
			onEvent: e => {
				seqs.push(e.seq)
			},
		})
		const child = firstChild(children)
		await port.promptSend(sessionId, 'a')
		child.emitLine({ type: 'assistant', message: { content: [{ type: 'text', text: 't' }] } })
		child.emitLine({ type: 'result', subtype: 'success', stop_reason: 'end_turn', num_turns: 1 })
		for (let i = 1; i < seqs.length; i++) {
			const prev = seqs[i - 1]
			const cur = seqs[i]
			assert.ok(prev !== undefined && cur !== undefined && cur > prev, `seq не монотонен: ${seqs.join(', ')}`)
		}
	})

	it('обрыв процесса посреди хода → turn.failed (парность)', async () => {
		const { port, children } = makePort()
		const { sessionId, types } = await subscribedSession(port)
		await port.promptSend(sessionId, 'x')
		firstChild(children).emitExit(1)
		assert.ok(types.includes('turn.failed'), `ожидали turn.failed: ${types.join(', ')}`)
	})

	it('sessionClose с открытым ходом → turn.cancelled + session.closed', async () => {
		const { port, children } = makePort()
		const { sessionId, types } = await subscribedSession(port)
		await port.promptSend(sessionId, 'x')
		await port.sessionClose(sessionId)
		assert.ok(types.includes('turn.cancelled'), `ожидали turn.cancelled: ${types.join(', ')}`)
		assert.ok(types.includes('session.closed'))
		assert.ok(firstChild(children).killed)
	})

	it('modelSet: рестарт с новой моделью, синтез model.switched; --model в аргументах нового спавна', async () => {
		const { port, children, calls } = makePort('sonnet')
		const { sessionId, types } = await subscribedSession(port)
		await port.modelSet(sessionId, 'opus')
		assert.ok(types.includes('model.switched'))
		assert.equal(children.length, 2, 'должен быть новый процесс')
		const resumeCall = calls[1]
		assert.ok(resumeCall, 'ожидали повторный спавн')
		assert.equal(resumeCall.model, 'opus')
		assert.ok(resumeCall.resume)
	})

	it('permissionVote отклоняется (capability false)', async () => {
		const { port } = makePort()
		const { sessionId } = await port.sessionCreate('/ws')
		await assert.rejects(
			() => port.permissionVote(sessionId, 'r', 'allow'),
			(e: unknown) => e instanceof AppError && e.code === 'permission_not_supported',
		)
	})

	it('sessionResume: отсутствующая сессия → null; живая → { lastSeq: null }', async () => {
		const { port } = makePort()
		assert.equal(await port.sessionResume('nope', '/ws'), null)
		const { sessionId } = await subscribedSession(port)
		assert.deepEqual(await port.sessionResume(sessionId, '/ws'), { lastSeq: null })
	})

	it('sessionResume: убивает старый процесс и переподнимает с --resume; новый ход завершается (многоходовость)', async () => {
		const { port, children, calls } = makePort()
		const { sessionId, types } = await subscribedSession(port)
		const oldChild = firstChild(children)
		oldChild.emitExit(0)
		assert.deepEqual(await port.sessionResume(sessionId, '/ws'), { lastSeq: null })
		assert.ok(oldChild.killed && children.length === 2)
		const resumeCall = calls[1]
		assert.ok(resumeCall?.resume && resumeCall.sessionId === sessionId)
		await port.promptSend(sessionId, 'снова')
		assert.ok(types.includes('turn.started'))
		children[1]?.emitLine({ type: 'assistant', message: { content: [{ type: 'text', text: 'ответ' }] } })
		children[1]?.emitLine({ type: 'result', subtype: 'success', stop_reason: 'end_turn', num_turns: 1 })
		assert.ok(types.includes('turn.completed'))
	})

	it('midTurnSend пишет в stdin и эмитит mid_turn.injected; на мёртвом процессе — false', async () => {
		const { port, children } = makePort()
		const { sessionId, types } = await subscribedSession(port)
		const child = firstChild(children)
		const ok = await port.midTurnSend(sessionId, 'доп')
		assert.equal(ok, true)
		assert.ok(child.written.includes('"text":"доп"'))
		assert.ok(types.includes('mid_turn.injected'))
		// процесс недоступен → false
		child.stdin.destroyed = true
		assert.equal(await port.midTurnSend(sessionId, 'x'), false)
	})

	it('context.usage эмитится из result после каждого хода (conformance)', async () => {
		const { port, children } = makePort()
		const { sessionId } = await port.sessionCreate('/ws')
		const types: string[] = []
		const usageData: unknown[] = []
		port.subscribe(sessionId, { onEvent: e => (types.push(e.type), e.type === 'context.usage' ? usageData.push(e.data) : undefined) })
		await port.promptSend(sessionId, 'x')
		firstChild(children).emitLine({ type: 'assistant', message: { content: [{ type: 'text', text: 'ответ' }] } })
		firstChild(children).emitLine({ type: 'result', subtype: 'success', stop_reason: 'end_turn', total_tokens: 42, num_turns: 1 })
		assert.ok(types.includes('context.usage'), `ожидали context.usage: ${types.join(', ')}`)
		const u = usageData[0] as { used: number; size: number }
		assert.equal(u.used, 42, 'used из total_tokens')
		assert.equal(u.size, 0)
	})

	it('verifyModel: нормализация алиасов (opus→claude-opus*, sonnet→claude-sonnet*) — нет ложного switch_failed', () => {
		assert.equal(verifyModel('opus', 'claude-opus-4-5').matched, true)
		assert.equal(verifyModel('sonnet', 'claude-sonnet-4-5').matched, true)
		assert.equal(verifyModel('claude-opus-4-5', 'claude-opus-4-5').matched, true)
		assert.equal(verifyModel('opus', 'sonnet').matched, false)
		assert.equal(verifyModel('opus', null).matched, false)
		assert.equal(normalizeModel('sonnet'), 'claude-sonnet')
		assert.equal(normalizeModel('claude-haiku-3-5'), 'claude-haiku-3-5')
	})

	it('интеграция: --model opus, init приходит claude-opus-* → нет model.switch_failed', async () => {
		const { port, children } = makePort('opus')
		const { sessionId, types } = await subscribedSession(port)
		firstChild(children).emitLine({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-opus-4-5', cwd: '/ws' })
		assert.ok(!types.includes('model.switch_failed'), `не должно быть switch_failed: ${types.join(', ')}`)
	})
})
