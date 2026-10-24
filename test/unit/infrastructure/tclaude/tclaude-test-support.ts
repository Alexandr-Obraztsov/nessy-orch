/** Общие хелперы unit-тестов tclaude-адаптера (фейковый процесс, спавн-заглушка, подписка). */
import { EventEmitter } from 'node:events'
import type { Writable } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import assert from 'node:assert/strict'
import { TclaudeAgentPort } from '../../../../src/infrastructure/tclaude/agent-port-tclaude'
import type { SpawnClaudeOptions } from '../../../../src/infrastructure/tclaude/spawn-claude'

/** Фейковый дочерний процесс tclaude: умеет эмитить NDJSON-строки в stdout и exit. */
export class FakeChild extends EventEmitter {
	stdout = Object.assign(new EventEmitter(), { setEncoding: (): void => undefined })
	stderr = Object.assign(new EventEmitter(), { setEncoding: (): void => undefined })
	stdin = {
		write: (chunk: string): boolean => {
			this.written += chunk
			return true
		},
		destroyed: false,
		writable: true,
	} as unknown as Writable

	written = ''
	killed = false
	signalLog: (string | number)[] = []
	exitCode: number | null = null
	signalCode: NodeJS.Signals | null = null
	stderrBuf = ''

	kill(signal?: NodeJS.Signals | number): boolean {
		this.killed = true
		this.signalLog.push(signal ?? 'SIGTERM')
		return true
	}

	/** отправить одну строку NDJSON в stdout процесса */
	emitLine(obj: unknown): void {
		this.stdout.emit('data', JSON.stringify(obj) + '\n')
	}

	emitStderr(text: string): void {
		this.stderrBuf += text
		this.stderr.emit('data', text)
	}

	emitExit(code: number): void {
		this.exitCode = code
		this.emit('exit', code, null)
	}
}

/** Спавн-заглушка: каждый спавн создаёт новый FakeChild и пишет вызовы в лог. */
export function makeFakeSpawn(): { spawnFn: (o: SpawnClaudeOptions) => ChildProcess; children: FakeChild[]; calls: SpawnClaudeOptions[] } {
	const children: FakeChild[] = []
	const calls: SpawnClaudeOptions[] = []
	return {
		children,
		calls,
		spawnFn: (o): ChildProcess => {
			calls.push(o)
			const c = new FakeChild()
			children.push(c)
			return c as unknown as ChildProcess
		},
	}
}

/** Адаптер на фейке со стабильными часами и моделью по умолчанию. */
export function makePort(model?: string | null): { port: TclaudeAgentPort; children: FakeChild[]; calls: SpawnClaudeOptions[] } {
	const { spawnFn, children, calls } = makeFakeSpawn()
	const port = new TclaudeAgentPort({ spawn: spawnFn, model: model ?? null, clock: { now: () => 100 } })
	return { port, children, calls }
}

/** Единственный (или первый) ребёнок из фейка; assertFn нужен для сужения по noUncheckedIndexedAccess. */
export function firstChild(children: FakeChild[]): FakeChild {
	const c = children[0]
	assert.ok(c, 'ожидали спавн процесса')
	return c
}

/** Подписанная сессия: создаёт сессию и подписывается, возвращает собранные типы. */
export async function subscribedSession(port: TclaudeAgentPort, cwd = '/ws'): Promise<{ sessionId: string; types: string[] }> {
	const { sessionId } = await port.sessionCreate(cwd)
	const types: string[] = []
	port.subscribe(sessionId, { onEvent: e => types.push(e.type) })
	return { sessionId, types }
}
