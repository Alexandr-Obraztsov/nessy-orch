/**
 * doctor — диагностика «сессии не создаются»: жив ли оркестратор, lock, записанные pid serve,
 * все `nessy serve` на машине (осиротевшие помечаются), агенты по пространствам против MAX_SESSIONS.
 * Работает и при лежащем оркестраторе: файлы home читаются напрямую. --fix — остановить осиротевшие serve.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { GraphView, StatusResponse } from '../../../../shared/types'
import { loadConfig } from '../../../infrastructure/config/load-config'
import { readText, writeAtomic } from '../../../infrastructure/persistence/jsonl'
import { LOCK_FILE, readLockPid } from '../../../infrastructure/process/instance-lock'
import { aliveMatching, isOrchCommand, isServeCommand, listProcesses, terminate } from '../../../infrastructure/process/process-table'
import { readServePids, SERVE_PIDS_FILE } from '../../../infrastructure/process/serve-processes'
import type { ProcessInfo } from '../../../infrastructure/process/process.types'
import { arr, bool, isObject, parseJson, str } from '../../../lib/json'
import { flagBool } from '../args'
import type { Parsed } from '../args.types'
import { bold, dim, green, red, yellow } from '../format'
import { ep, get, json, out } from '../io'
import type { CommandTable } from './command.types'
import type { DoctorReport, DoctorServe, DoctorSpace, ServeOwnership } from './doctor.types'

const MAX_CMD = 140

/** Классификация процессов serve (чистая функция — проверяется тестами). */
export function classifyServes(procs: readonly ProcessInfo[], ownerPid: number | null, recorded: ReadonlySet<number>): DoctorServe[] {
	const byPid = new Map(procs.map(p => [p.pid, p]))
	return procs
		.filter(p => isServeCommand(p.command))
		.map(p => {
			let owner: ServeOwnership = 'foreign'
			if (ownerPid !== null && p.ppid === ownerPid) owner = 'owned'
			else if (p.ppid === 1 || recorded.has(p.pid) || isOrchCommand(byPid.get(p.ppid)?.command ?? '')) owner = 'orphan'
			return { ...p, owner }
		})
}

/** Пространства и агенты: из /graph, если оркестратор жив, иначе из <home>/state.json. */
function spaceCounts(graph: GraphView | null, home: string): DoctorSpace[] {
	const spaces = new Map<string, DoctorSpace>()
	const add = (name: string): DoctorSpace => {
		let s = spaces.get(name)
		if (!s) spaces.set(name, (s = { name, active: 0, archived: 0 }))
		return s
	}
	if (graph) {
		for (const s of graph.spaces) add(s.name)
		for (const a of graph.agents) add(a.space)[a.archived ? 'archived' : 'active']++
	} else {
		const st = parseJson(readText(path.join(home, 'state.json')))
		if (isObject(st)) {
			for (const s of arr(st['spaces'])) if (isObject(s)) add(str(s['name']))
			for (const a of arr(st['agents'])) if (isObject(a)) add(str(a['space']))[bool(a['archived']) ? 'archived' : 'active']++
		}
	}
	return [...spaces.values()]
}

async function collect(): Promise<DoctorReport> {
	const config = loadConfig()
	const home = config.home
	const status = await get<StatusResponse>('/status').catch(() => null)
	const graph = status ? await get<GraphView>('/graph').catch(() => null) : null
	const lockFile = path.join(home, LOCK_FILE)
	const lockPid = readLockPid(lockFile)
	const lockAlive = lockPid !== null && aliveMatching(lockPid, isOrchCommand)
	const ownerPid = status?.pid ?? (lockAlive ? lockPid : null)
	const procs = listProcesses()
	const records = readServePids(path.join(home, SERVE_PIDS_FILE)).map(r => ({ ...r, alive: aliveMatching(r.pid, isServeCommand) }))
	const serves = classifyServes(procs, ownerPid, new Set(records.map(r => r.pid)))
	const orchestrators = procs.filter(p => isOrchCommand(p.command))
	const spaces = spaceCounts(graph, home)
	const report: DoctorReport = {
		home,
		port: ep.port,
		status,
		lock: { file: lockFile, pid: lockPid, alive: lockAlive },
		ownerPid,
		orchestrators,
		records,
		serves,
		maxSessions: config.maxSessionsPerSpace,
		spaces,
		hints: [],
	}
	report.hints = hints(report)
	return report
}

function hints(r: DoctorReport): string[] {
	const h: string[] = []
	const orphans = r.serves.filter(s => s.owner === 'orphan').length
	if (!r.status)
		h.push(
			r.lock.alive
				? `процесс оркестратора жив (pid ${r.lock.pid}), но не отвечает на :${r.port} — проверьте ~/.nessy-orch/logs/orch.err.log`
				: 'оркестратор не запущен: `launchctl kickstart -k gui/$(id -u)/com.nessy.orch` или `node ~/Projects/nessy-orch/dist/src/main.js`',
		)
	if (orphans) h.push(`осиротевших nessy serve: ${orphans} — остановить: \`nessy-orch doctor --fix\``)
	if (r.orchestrators.length > 1)
		h.push(
			`процессов оркестратора: ${r.orchestrators.length} — не запускайте второй экземпляр рядом с launchd ` +
				'(`launchctl list | grep nessy`; для ручного запуска сначала `nessy-orch uninstall`)',
		)
	if (r.lock.pid !== null && !r.lock.alive) h.push(`lock-файл устарел (pid ${r.lock.pid} не работает) — будет перезаписан при запуске`)
	for (const s of r.spaces) {
		const total = s.active + s.archived
		if (total >= r.maxSessions)
			h.push(
				`пространство «${s.name}»: агентов ${total} при MAX_SESSIONS=${r.maxSessions} — старые сессии вытесняются; ` +
					'удалите ненужных (`nessy-orch kill <агент>`) или увеличьте MAX_SESSIONS',
			)
	}
	if (!h.length) h.push('проблем не найдено')
	return h
}

const OWNER_LABEL: Record<ServeOwnership, string> = {
	owned: green('оркестратора'),
	orphan: red('осиротевший'),
	foreign: dim('не от оркестратора'),
}

const trim = (s: string): string => (s.length > MAX_CMD ? s.slice(0, MAX_CMD - 1) + '…' : s)

function print(r: DoctorReport): void {
	if (r.status)
		out(`${green('●')} оркестратор: nessy-orch ${r.status.version}  pid ${r.status.pid}  uptime ${r.status.uptimeSec}s  http://127.0.0.1:${r.port}`)
	else out(`${red('○')} оркестратор недоступен на http://127.0.0.1:${r.port}`)
	out(`  home: ${r.home}`)
	out(`  lock: ${r.lock.pid === null ? 'нет' : `pid ${r.lock.pid} — ${r.lock.alive ? 'работает' : yellow('не работает (устаревший)')}`}  ${dim(r.lock.file)}`)
	if (r.orchestrators.length)
		for (const o of r.orchestrators) out(`  процесс оркестратора: pid ${o.pid}  ppid ${o.ppid}  ${o.etime}  ${dim(trim(o.command))}`)

	out('')
	out(bold(`Записанные serve (${SERVE_PIDS_FILE}): ${r.records.length}`))
	for (const rec of r.records)
		out(`  pid ${rec.pid}  port ${rec.port}  ${rec.alive ? green('жив') : dim('завершён')}  ${rec.workspace}  ${dim(rec.startedAt)}`)

	out('')
	out(bold(`Процессы nessy serve на машине: ${r.serves.length}`))
	for (const s of r.serves) out(`  pid ${s.pid}  ppid ${s.ppid}  ${s.etime}  ${OWNER_LABEL[s.owner]}  ${dim(trim(s.command))}`)

	out('')
	out(bold(`Пространства (MAX_SESSIONS=${r.maxSessions}):`))
	if (!r.spaces.length) out('  нет')
	for (const s of r.spaces) {
		const total = s.active + s.archived
		const mark = total >= r.maxSessions ? red(' ⚠ лимит') : ''
		out(`  ${s.name}: агентов ${total} (активных ${s.active}, в архиве ${s.archived})${mark}`)
	}

	out('')
	out(bold('Подсказки:'))
	for (const h of r.hints) out(`  • ${h}`)
}

/** Остановить осиротевшие serve; при лежащем оркестраторе — убрать из serve-pids.json завершённые записи. */
async function fix(r: DoctorReport): Promise<void> {
	const orphans = r.serves.filter(s => s.owner === 'orphan')
	out('')
	if (!orphans.length) out('--fix: осиротевших nessy serve нет')
	for (const s of orphans) {
		const ok = await terminate(s.pid, isServeCommand)
		out(ok ? `--fix: остановлен nessy serve pid=${s.pid}` : `--fix: pid=${s.pid} уже завершился`)
	}
	if (!r.status && !r.lock.alive) {
		const file = path.join(r.home, SERVE_PIDS_FILE)
		if (fs.existsSync(file)) writeAtomic(file, JSON.stringify(readServePids(file).filter(rec => aliveMatching(rec.pid, isServeCommand)), null, 2) + '\n')
	}
}

async function cmdDoctor(p: Parsed): Promise<void> {
	const report = await collect()
	if (flagBool(p, 'json')) json(report)
	else print(report)
	if (flagBool(p, 'fix')) await fix(report)
}

export const doctorCommands: CommandTable = {
	doctor: { run: cmdDoctor, spec: { bool: ['json', 'help', 'fix'] } },
}
