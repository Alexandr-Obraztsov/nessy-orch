/** Процессы для тестов запуска: настоящий dist/src/main.js и «пустышки» с нужной командной строкой. */
import { spawn, type ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import { FAKE, ROOT } from './harness'

export const MAIN = path.join(ROOT, 'dist', 'src', 'main.js')

/** Долгоживущий node-процесс; extra попадает в командную строку (`… serve --workspace x`, `dist/src/main.js`). */
export function spawnDummy(extra: string[]): ChildProcess {
	return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', ...extra], { stdio: 'ignore' })
}

/** Дождаться выхода процесса; true — вышел за ms. */
export function exited(proc: ChildProcess, ms: number): Promise<boolean> {
	if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true)
	return new Promise(resolve => {
		const t = setTimeout(() => resolve(false), ms)
		proc.once('exit', () => {
			clearTimeout(t)
			resolve(true)
		})
	})
}

export interface MainRun {
	proc: ChildProcess
	output: () => string
	/** код выхода (null — убит сигналом) */
	exit: Promise<number | null>
}

/** Запустить настоящий оркестратор с фейковым nessy. */
export function runMain(env: Record<string, string>): MainRun {
	const proc = spawn(process.execPath, [MAIN], {
		env: { ...process.env, NESSY_BIN: FAKE, ORCH_SEED_ROLES: '0', FAKE_NESSY_DELAY_MS: '10', ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	let buf = ''
	proc.stdout.on('data', (d: Buffer) => (buf += d.toString()))
	proc.stderr.on('data', (d: Buffer) => (buf += d.toString()))
	const exit = new Promise<number | null>(resolve => proc.once('exit', code => resolve(code)))
	return { proc, output: () => buf, exit }
}
