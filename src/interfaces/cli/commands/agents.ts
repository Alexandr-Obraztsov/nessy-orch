/**
 * Команды агентов: spawn, send, ask, wait, ls (дерево), show, plan, model, runtime ls, cancel, kill, archive, restore.
 * `spawn --runtime <nessy-sdk|tclaude> --model <M>`; рекурсивные send/spawn/plan несут `--from`/`--key`,
 * чтобы субагент сохранял свою идентичность.
 */
import * as path from 'node:path'
import type { AgentEvent, AgentView, GraphView, RuntimeInfo, SendResponse, SpawnResponse, WaitResponse } from '../../../../shared/types'
import { parsePlanArgs } from '../../../domain/plan'
import { flagBool, flagNum, flagStr } from '../args'
import type { Parsed } from '../args.types'
import { CliError } from '../errors'
import { bold, dim, green, planText, red, runtimeModelCell, table } from '../format'
import type { Ctx } from '../ctx'
import { ASK_FLAGS, COMMON, LS_FLAGS, PLAN_FLAGS, SEND_FLAGS, SHOW_FLAGS, SPAWN_FLAGS, WAIT_CMD_FLAGS } from '../flags'
import { renderAgentEvent } from '../render-event'
import { parseRuntimeId } from '../runtime-id'
import { buildForest, renderTree } from '../tree'
import type { CommandTable } from './command.types'

/** Сколько ждём результат по умолчанию, секунд. */
const DEFAULT_WAIT_SEC = 1500

/** Ждать ли результата: оператор по умолчанию ждёт, агент (`--from`) — нет; `--wait`/`--no-wait` переопределяют. */
function waits(p: Parsed): boolean {
	if (flagBool(p, 'no-wait')) return false
	return flagBool(p, 'wait') || flagStr(p, 'from') === undefined
}

/** Пространство именем или путём; относительный путь — от текущего каталога CLI. */
function spaceArg(v: string | undefined, cwd: string): string | undefined {
	if (v === undefined) return undefined
	return v.startsWith('.') || v.includes('/') ? path.resolve(cwd, v) : v
}

/** id сессии: флаг --session, иначе NESSY_ORCH_SESSION; пусто — без сессии. */
function sessionOf(p: Parsed, env: NodeJS.ProcessEnv): string | undefined {
	const v = flagStr(p, 'session') ?? env['NESSY_ORCH_SESSION']
	const t = v?.trim()
	return t ? t : undefined
}

/** Общий вывод spawn/send: имя агента — в stderr (служебное), полезный результат — в stdout. */
function printSendResult(c: Ctx, agent: AgentView | null, r: SendResponse): void {
	if (flagBool(c.p, 'json')) return c.json(agent ? { agent, ...r } : r)
	if (agent) c.info(`${green('✓')} агент ${bold(agent.name)}${agent.title ? ` «${agent.title}»` : ''} (id ${agent.id}) в «${agent.space}»`)
	if (r.reply) {
		if (r.reply.failed) c.info(red(`агент ответил с ошибкой: ${r.reply.failed}`))
		c.out(r.reply.text)
	} else if (r.timedOut) {
		throw new CliError(
			`ответ не получен за отведённое время; агент продолжает работу. Дождаться снова (в фоне): nessy-orch wait ${agent?.id ?? r.message.to}`,
			3,
		)
	} else {
		if (r.started && !agent) c.info(dim('агент был свободен — сообщение запустило его в работу'))
		else if (r.interrupted) c.info(dim('агент работал — его ход прерван этим сообщением (--interrupt)'))
		else if (r.queued) c.info(dim('агент работает — сообщение доставлено в идущий ход (или встанет в очередь)'))
		c.info(dim(`отправлено ${r.message.id} → ${r.message.to}. Результат: nessy-orch wait ${agent?.id ?? r.message.to} (в фоне)`))
	}
}

/** spawn: создать агента, при --wait — дождаться ответа. --runtime/--model уходят в тело запроса. */
async function cmdSpawn(c: Ctx): Promise<void> {
	const { p, t, cwd, env } = c
	const prompt = p.positionals.join(' ').trim()
	const wait = waits(p) && prompt !== ''
	if (flagBool(p, 'wait') && !prompt) throw new CliError('--wait требует текст поручения', 2)
	const timeout = flagNum(p, 'timeout') ?? DEFAULT_WAIT_SEC
	const runtime = parseRuntimeId(flagStr(p, 'runtime'))
	const r = await t.post<SpawnResponse>('/agents', {
		space: spaceArg(flagStr(p, 'space'), cwd),
		cwd,
		name: flagStr(p, 'name'),
		title: flagStr(p, 'title'),
		role: flagStr(p, 'role'),
		session: sessionOf(p, env),
		from: flagStr(p, 'from'),
		prompt: prompt || undefined,
		runtime,
		model: flagStr(p, 'model'),
		wait: false,
		waitTimeoutSec: timeout,
	})
	if (!wait) return printSendResult(c, r.agent, r)
	const a = r.agent
	if (!flagBool(p, 'json'))
		c.info(
			`${green('✓')} агент ${bold(a.name)}${a.title ? ` «${a.title}»` : ''} (id ${a.id}) в «${a.space}»: работает; написать ему: nessy-orch send ${a.name} "…"`,
		)
	const w = await t.get<WaitResponse>(`/agents/${encodeURIComponent(a.id)}/wait?timeout=${timeout}`)
	if (flagBool(p, 'json')) return c.json({ agent: w.agent, ...(w.reply ? { reply: w.reply } : {}), ...(w.done ? {} : { timedOut: true }) })
	if (!w.done)
		throw new CliError(`ответ не получен за отведённое время; агент ${a.name} продолжает работу. Дождаться снова (в фоне): nessy-orch wait ${a.name}`, 3)
	if (w.reply?.failed) c.info(red(`агент ответил с ошибкой: ${w.reply.failed}`))
	c.out(w.reply?.text ?? '(агент ничего не ответил)')
}

/** send: отправить сообщение агенту (или you). */
async function cmdSend(c: Ctx): Promise<void> {
	const { p, t } = c
	const [to, ...rest] = p.positionals
	const text = rest.join(' ').trim()
	if (!to || !text) throw new CliError('использование: nessy-orch send <агент|you> "текст" [--no-wait] [--interrupt] [--from ID]', 2)
	const r = await t.post<SendResponse>(`/agents/${encodeURIComponent(to)}/send`, {
		text,
		from: flagStr(p, 'from'),
		interrupt: flagBool(p, 'interrupt') ? true : undefined,
		wait: to !== 'you' && waits(p),
		waitTimeoutSec: flagNum(p, 'timeout') ?? DEFAULT_WAIT_SEC,
	})
	printSendResult(c, null, r)
}

/** ask: короткий spawn в другом пространстве с ожиданием. */
async function cmdAsk(c: Ctx): Promise<void> {
	const { p, t, cwd, env } = c
	const [space, ...rest] = p.positionals
	const prompt = rest.join(' ').trim()
	if (!space || !prompt) throw new CliError('использование: nessy-orch ask <путь|пространство> "поручение"', 2)
	const r = await t.post<SpawnResponse>('/agents', {
		space: spaceArg(space, cwd),
		session: sessionOf(p, env),
		from: flagStr(p, 'from'),
		prompt,
		wait: true,
		waitTimeoutSec: flagNum(p, 'timeout') ?? DEFAULT_WAIT_SEC,
	})
	printSendResult(c, r.agent, r)
}

/** wait: дождаться освобождения агента и вывести последний ответ. */
async function cmdWait(c: Ctx): Promise<void> {
	const { p, t } = c
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch wait <агент> [--timeout СЕК]', 2)
	const r = await t.get<WaitResponse>(`/agents/${encodeURIComponent(ref)}/wait?timeout=${flagNum(p, 'timeout') ?? DEFAULT_WAIT_SEC}`)
	if (flagBool(p, 'json')) return c.json(r)
	if (!r.done) throw new CliError(`агент ${r.agent.name} ещё работает; дождаться снова (в фоне): nessy-orch wait ${ref}`, 3)
	if (!r.reply) return c.info(dim(`агент ${r.agent.name} свободен и ничего не отвечал`))
	if (r.reply.failed) c.info(red(`агент ответил с ошибкой: ${r.reply.failed}`))
	c.out(r.reply.text)
}

/** ls: дерево агентов (агенты + субагенты) с рантаймом, моделью, статусом и контекстом %. */
async function cmdLs(c: Ctx): Promise<void> {
	const { p, t } = c
	const g = await t.get<GraphView>('/graph')
	const session = flagStr(p, 'session')
	const scope = session === undefined ? g.agents : g.agents.filter(a => a.session === session)
	const list = flagBool(p, 'all') ? scope : scope.filter(a => !a.archived)
	if (flagBool(p, 'json')) return c.json(list)
	if (!list.length) return c.out('активных агентов нет. Создайте: nessy-orch spawn --session <id> "поручение"')
	const archivedIds = new Set(scope.filter(a => a.archived).map(a => a.id))
	const forest = buildForest(list, undefined, archivedIds)
	const header = session ? `сессия ${session}` : 'you'
	c.out(renderTree(forest, header))
	if (scope.length - list.length) c.info(dim(`в архиве: ${scope.length - list.length} (показать: nessy-orch ls --all)`))
}

/** show: агент и последние события. */
async function cmdShow(c: Ctx): Promise<void> {
	const { p, t } = c
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch show <агент>', 2)
	const [a, ev] = await Promise.all([
		t.get<AgentView>(`/agents/${encodeURIComponent(ref)}`),
		t.get<AgentEvent[]>(`/agents/${encodeURIComponent(ref)}/history?limit=${flagNum(p, 'n') ?? 40}`),
	])
	if (flagBool(p, 'json')) return c.json({ agent: a, events: ev })
	const tags = [a.session ? `сессия ${a.session}` : '', a.role ? `роль ${a.role}` : '', a.archived ? 'в архиве' : ''].filter(Boolean).join(', ')
	c.out(
		`${bold(a.id)} ${a.name !== a.id ? `(${a.name}) ` : ''}${a.status}${tags ? dim(` [${tags}]`) : ''}  ${a.space}${a.displayName ? `  «${a.displayName}»` : ''}`,
	)
	if (a.runtime || a.model || a.modelRequested) c.out(`${dim('рантайм · модель')} ${runtimeModelCell(a)}${a.model && a.modelConfirmed === false ? dim(' (не подтверждена)') : ''}`)
	for (const e of ev) c.out(renderAgentEvent(e))
}

const PLAN_USAGE = 'использование: nessy-orch plan --from <твой id> "- [x] шаг" "- [~] шаг" "- [ ] шаг" | plan <агент> [--clear]'

/** plan: с --from — публикация чек-листа; --clear — убрать; без пунктов — показать. */
async function cmdPlan(c: Ctx): Promise<void> {
	const { p, t } = c
	const from = flagStr(p, 'from')
	const args = [...p.positionals]
	const ref = from ?? args.shift()
	if (!ref) throw new CliError(PLAN_USAGE, 2)
	let a: AgentView
	if (flagBool(p, 'clear')) {
		if (args.length) throw new CliError('--clear не сочетается с пунктами плана', 2)
		await t.del(`/agents/${encodeURIComponent(ref)}/plan${from ? `?from=${encodeURIComponent(from)}` : ''}`)
		a = await t.get<AgentView>(`/agents/${encodeURIComponent(ref)}`)
	} else if (args.length) {
		a = await t.post<AgentView>(`/agents/${encodeURIComponent(ref)}/plan`, { from, entries: parsePlanArgs(args) })
	} else {
		a = await t.get<AgentView>(`/agents/${encodeURIComponent(ref)}`)
	}
	if (flagBool(p, 'json')) return c.json(a.plan)
	c.out(a.plan ? planText(a.plan) : dim(`у агента ${a.id} нет плана`))
}

/** model <агент> <модель>: сменить модель свободного агента (рантайм должен уметь setModel). */
async function cmdModel(c: Ctx): Promise<void> {
	const { p, t } = c
	const [ref, ...rest] = p.positionals
	const model = rest.join(' ').trim()
	if (!ref || !model) throw new CliError('использование: nessy-orch model <агент> <модель>', 2)
	const a = await t.post<AgentView>(`/agents/${encodeURIComponent(ref)}/model`, { model })
	if (flagBool(p, 'json')) return c.json(a)
	c.out(`${green('✓')} модель ${bold(a.id)}: ${runtimeModelCell(a)}`)
}

/** runtime ls: каталог рантаймов (id, доступность, модель по умолчанию, модели, возможности). */
async function cmdRuntime(c: Ctx): Promise<void> {
	const { p, t } = c
	const [sub] = p.positionals
	if (sub !== undefined && sub !== 'ls') throw new CliError(`неизвестная подкоманда runtime ${sub}\nиспользование: runtime ls`, 2)
	const list = await t.get<RuntimeInfo[]>('/runtimes')
	if (flagBool(p, 'json')) return c.json(list)
	if (!list.length) return c.out(dim('рантаймов нет'))
	c.out(
		table(
			list.map(r => {
				const caps = Object.entries(r.capabilities)
					.filter(([, on]) => on)
					.map(([k]) => k)
				return [
					bold(r.id),
					r.available ? green('да') : red('нет'),
					r.defaultModel ?? dim('—'),
					r.models.length ? r.models.map(m => m.id).join(', ') : dim('—'),
					caps.length ? caps.join(', ') : dim('—'),
				]
			}),
			['ID', 'ДОСТУПЕН', 'МОДЕЛЬ ПО УМОЛЧАНИЮ', 'МОДЕЛИ', 'ВОЗМОЖНОСТИ'],
		),
	)
}

/** cancel: прервать ход агента. */
async function cmdCancel(c: Ctx): Promise<void> {
	const { p, t } = c
	const ref = p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch cancel <агент>', 2)
	const a = await t.post<AgentView>(`/agents/${encodeURIComponent(ref)}/cancel`, {})
	c.out(flagBool(p, 'json') ? JSON.stringify(a) : `${green('✓')} прервано: ${a.id} (${a.status})`)
}

/** kill: удалить агента. */
async function cmdKill(c: Ctx): Promise<void> {
	const ref = c.p.positionals[0]
	if (!ref) throw new CliError('использование: nessy-orch kill <агент>', 2)
	await c.t.del(`/agents/${encodeURIComponent(ref)}`)
	c.out(`${green('✓')} удалён: ${ref}`)
}

/** archive / restore: убрать агента в архив или вернуть (сообщение архивному агенту будит его само). */
async function cmdArchive(c: Ctx, action: 'archive' | 'restore'): Promise<void> {
	const { p, t } = c
	const ref = p.positionals[0]
	if (!ref) throw new CliError(`использование: nessy-orch ${action} <агент>`, 2)
	const a = await t.post<AgentView>(`/agents/${encodeURIComponent(ref)}/${action}`, {})
	if (flagBool(p, 'json')) return c.json(a)
	c.out(`${green('✓')} ${action === 'archive' ? 'в архиве' : 'возвращён из архива'}: ${a.id}`)
}

export const agentCommands: CommandTable = {
	ls: { run: cmdLs, spec: LS_FLAGS },
	spawn: { run: cmdSpawn, spec: SPAWN_FLAGS },
	wait: { run: cmdWait, spec: WAIT_CMD_FLAGS },
	send: { run: cmdSend, spec: SEND_FLAGS },
	ask: { run: cmdAsk, spec: ASK_FLAGS },
	show: { run: cmdShow, spec: SHOW_FLAGS },
	plan: { run: cmdPlan, spec: PLAN_FLAGS },
	model: { run: cmdModel, spec: COMMON },
	runtime: { run: cmdRuntime, spec: COMMON },
	cancel: { run: cmdCancel, spec: COMMON },
	kill: { run: cmdKill, spec: COMMON },
	archive: { run: c => cmdArchive(c, 'archive'), spec: COMMON },
	restore: { run: c => cmdArchive(c, 'restore'), spec: COMMON },
}
