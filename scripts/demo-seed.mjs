#!/usr/bin/env node
// Демо-данные: две задачи от двух «Claude» с несколькими агентами в каждой (сценарии fake-nessy `#work`).
// Ждёт, пока оркестратор поднимется (ORCH_PORT, по умолчанию 4337), и создаёт всё через API.
// Повторный запуск не дублирует: задачи с теми же id пропускаются. Запуск: `npm run demo` (вместе с сервером)
// или `npm run demo:seed` (к уже запущенному демо).
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'

const PORT = Number(process.env.ORCH_PORT ?? 4337)
const BASE = `http://127.0.0.1:${PORT}`

function api(method, p, body) {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? null : JSON.stringify(body)
		const req = http.request(
			{
				host: '127.0.0.1',
				port: PORT,
				method,
				path: p,
				headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
			},
			res => {
				let d = ''
				res.setEncoding('utf8')
				res.on('data', c => (d += c))
				res.on('end', () => resolve({ status: res.statusCode ?? 0, body: d ? JSON.parse(d) : {} }))
			},
		)
		req.on('error', reject)
		if (payload) req.write(payload)
		req.end()
	})
}

async function waitUp(ms = 60000) {
	const t0 = Date.now()
	for (;;) {
		try {
			if ((await api('GET', '/health')).status === 200) return
		} catch {
			/* ещё не поднялся */
		}
		if (Date.now() - t0 > ms) throw new Error(`оркестратор не поднялся на ${BASE} за ${ms / 1000} с`)
		await new Promise(r => setTimeout(r, 300))
	}
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Ответ агента в формате nessy-orch: итог, детали, источники, статус. */
const reply = (itog, details, sources, status = 'DONE') =>
	[
		`**Итог** — ${itog}`,
		'',
		'**Детали**',
		...details.map(d => `- ${d}`),
		'',
		'**Источники**',
		...sources.map((s, i) => `${i + 1}. ${s}`),
		'',
		`Статус: ${status}`,
	]
		.join('\\n')

/** Задачи и их агенты. `#work[~] K шаг => Tool: арг; … || ответ` — см. test/support/fake-nessy.ts. */
const TASKS = [
	{
		task: { id: 'demo-fix-ci', title: 'Починить падающий CI в shippy', owner: 'claude-1' },
		space: 'shippy',
		agents: [
			{
				name: 'ci-explorer',
				role: 'code-explorer',
				prompt:
					'#work~ 1 Найти упавший job => GitLab: pipelines shippy; Прочитать лог => Shell: glab ci trace 48211; Найти коммит-виновник => Git: log -S retryPolicy; Сформулировать причину => Think: причина || ' +
					reply(
						'CI падает на `test:integration` из-за таймаута ретраев после коммита `a1b2c3d` [1][2].',
						['`retryPolicy.maxDelay` уменьшен с 30 до 3 с — тест ждёт дольше [2]', 'Падает только job `test:integration`, остальные зелёные [1]'],
						['https://gitlab.example.com/shippy/-/pipelines/48211', '`shippy@a1b2c3d:src/net/retry.ts:42`', '`glab ci trace 48211`'],
					),
			},
			{
				name: 'ci-fixer',
				role: 'executor',
				prompt:
					'#work 1 Создать ветку => Shell: git switch -c fix/retry-delay; Поправить maxDelay => Edit: src/net/retry.ts; Запушить фикс => ?Shell: git push origin fix/retry-delay; Открыть MR => GitLab: create MR || ' +
					reply('Фикс запушен, MR открыт [1].', ['`maxDelay` возвращён к 30 с [2]'], ['https://gitlab.example.com/shippy/-/merge_requests/512', '`shippy@fix/retry-delay:src/net/retry.ts:42`']),
			},
			{
				name: 'ci-verifier',
				role: 'verifier',
				prompt:
					'#work 3 Проверить вывод explorer => Read: ответ ci-explorer; Сверить коммит => Git: show a1b2c3d; Перезапустить job локально => Shell: npm run test:integration || ' +
					reply(
						'Причина подтверждена: после отката `maxDelay` тест проходит [1][3].',
						['Коммит `a1b2c3d` действительно меняет `maxDelay` [2]'],
						['`npm run test:integration`', '`git show a1b2c3d`', '`shippy@a1b2c3d:src/net/retry.ts:42`'],
						'DONE_WITH_CONCERNS — флейки в соседнем тесте не проверены',
					),
			},
		],
	},
	{
		task: { id: 'demo-review-mr', title: 'Ревью MR !482 и отчёт в Jira', owner: 'claude-2' },
		space: 'nessy-orch',
		agents: [
			{
				name: 'mr-reviewer',
				role: 'gitlab-mr-reviewer',
				prompt:
					'#work~ 0 Получить diff MR => GitLab: MR !482 diff; Прочитать изменения => Read: src/payments/*.ts; Проверить тесты => Shell: npm test -- payments; Написать замечания => Think: замечания || ' +
					reply(
						'MR !482 можно мержить после двух правок [1].',
						['Нет проверки `amount <= 0` в `refund()` [2]', 'Тест на двойной возврат отсутствует [3]'],
						['https://gitlab.example.com/shop/-/merge_requests/482', '`shop@9f8e7d6:src/payments/refund.ts:57`', '`shop@9f8e7d6:test/payments/refund.test.ts`'],
					),
				// агент, запущенный этим агентом, наследует задачу
				children: [
					{
						name: 'sec-check',
						role: 'security-reviewer',
						prompt:
							'#work~ 1 Найти точки ввода => Grep: req.body; Проверить валидацию => Read: src/payments/validate.ts; Сверить с OWASP => Wiki: OWASP ASVS || ' +
							reply('Уязвимостей не найдено, валидация суммы есть на входе [1].', ['Схема `RefundRequest` ограничивает `amount` [1]'], ['`shop@9f8e7d6:src/payments/validate.ts:12`', 'https://owasp.org/www-project-application-security-verification-standard/']),
					},
				],
			},
			{
				name: 'jira-writer',
				role: 'jira-analyst',
				prompt:
					'#work 1 Найти задачу в Jira => Jira: SHOP-1203; Собрать итоги ревью => Read: ответ mr-reviewer; Написать комментарий => Jira: comment SHOP-1203 || ' +
					reply('Комментарий с итогами ревью добавлен в SHOP-1203 [1].', ['Указаны две обязательные правки [1]'], ['https://jira.example.com/browse/SHOP-1203']),
			},
		],
	},
]

async function spawn(spec, task, space, from) {
	const r = await api('POST', '/agents', {
		space,
		task: from ? undefined : task,
		from,
		name: spec.name,
		role: spec.role,
		prompt: spec.prompt,
	})
	if (r.status !== 201) throw new Error(`spawn ${spec.name}: ${r.body.error ?? r.status}`)
	console.log(`[demo-seed]   агент ${spec.name} (${r.body.agent.id}) → задача ${r.body.agent.task}`)
	for (const child of spec.children ?? []) {
		await sleep(400)
		await spawn(child, task, space, r.body.agent.id)
	}
}

async function main() {
	await waitUp()
	const shippy = path.join(os.tmpdir(), 'nessy-orch-demo-ws', 'shippy')
	fs.mkdirSync(shippy, { recursive: true })
	await api('POST', '/spaces', { path: shippy, name: 'shippy' })
	await api('POST', '/spaces', { path: process.cwd(), name: 'nessy-orch' })
	const roles = new Set((await api('GET', '/roles')).body.map(r => r.id))
	for (const t of TASKS) {
		const r = await api('POST', '/tasks', t.task)
		if (r.status === 409) {
			console.log(`[demo-seed] задача ${t.task.id} уже есть — пропускаю`)
			continue
		}
		if (r.status !== 201) throw new Error(`задача ${t.task.id}: ${r.body.error ?? r.status}`)
		console.log(`[demo-seed] задача ${r.body.id} (${t.task.owner}): ${BASE}/?task=${r.body.id}`)
		const strip = a => ({ ...a, role: roles.has(a.role) ? a.role : undefined, children: a.children?.map(strip) })
		for (const a of t.agents) await spawn(strip(a), r.body.id, t.space)
	}
	console.log(`[demo-seed] готово: ${BASE}`)
}

main().catch(e => {
	console.error(`[demo-seed] ошибка: ${e instanceof Error ? e.message : String(e)}`)
	process.exit(1)
})
