#!/usr/bin/env node
/**
 * nessy-orch — CLI оркестратора. Правило вывода: полезный результат — в stdout, служебное — в stderr.
 */
import { errMsg } from '../../lib/json'
import { CliError } from './errors'
import { red } from './format'
import { runCommand } from './dispatch'
import { makeTransport } from './transport'

async function main(): Promise<void> {
	const t = makeTransport(process.env)
	await runCommand(process.argv.slice(2), t, {
		cwd: process.cwd(),
		env: process.env,
		out: s => process.stdout.write(s + '\n'),
		info: s => process.stderr.write(s + '\n'),
	})
}

main().catch((e: unknown) => {
	process.stderr.write(red('✗ ') + errMsg(e) + '\n')
	process.exit(e instanceof CliError ? e.exitCode : 1)
})
