#!/usr/bin/env node
// Демо-данные: две сессии от двух «Claude» с несколькими агентами в каждой. Поручения — обычный текст, а сценарии
// заглушки fake-nessy лежат отдельно: $NESSY_ORCH_HOME/fake-scenarios.json (ключ — первая строка поручения).
// Ждёт, пока оркестратор поднимется (ORCH_PORT, по умолчанию 4337), и создаёт всё через API.
// Повторный запуск не дублирует: сессии с теми же id пропускаются. Запуск: `npm run demo` (вместе с сервером)
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

/** Ответ агента в формате nessy-orch: итог, детали, источники, статус (настоящие переносы строк). */
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
	].join('\n')

/** Поручение в стиле оркестратора. Первая строка («Цель») — ключ сценария заглушки, поэтому уникальна. */
const brief = (goal, context, limits, result) => `Цель: ${goal}\nКонтекст: ${context}\nГраницы: ${limits}\nРезультат: ${result}`

/**
 * Сессии и их агенты. Видимое в UI — `prompt` (человеческий текст). Что делает заглушка nessy, лежит отдельно
 * в `scenario` и уходит в $NESSY_ORCH_HOME/fake-scenarios.json (ключ — первая строка prompt).
 * Сценарий: строка `#work[~] K шаг => Tool: арг; … || ответ` (см. test/support/fake-nessy.ts) или массив операций.
 */
const RETRY_BEFORE = `export const retryPolicy = {
	attempts: 5,
	baseDelay: 200,
	maxDelay: 3000,
}`
const RETRY_AFTER = `export const retryPolicy = {
	attempts: 5,
	baseDelay: 200,
	maxDelay: 30_000,
}`

const SESSIONS = [
	{
		session: { id: 'demo-fix-ci', title: 'Починить падающий CI в shippy', owner: 'claude-1' },
		space: 'shippy',
		agents: [
			{
				name: 'ci-explorer',
				role: 'code-explorer',
				prompt: brief(
					'выяснить, почему падает job test:integration в пайплайне 48211 репозитория shippy.',
					'CI покраснел сегодня утром после мержа в main, остальные job зелёные.',
					'только чтение: код не менять, ничего не пушить.',
					'причина падения и коммит-виновник со ссылками на лог и код.',
				),
				scenario:
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
				prompt: brief(
					'вернуть maxDelay в retryPolicy и открыть MR с фиксом.',
					'причина падения CI найдена: коммит a1b2c3d уменьшил maxDelay с 30 до 3 секунд.',
					'править только src/net/retry.ts; пуш в ветку fix/retry-delay, в main не лить.',
					'ссылка на MR и вывод прогона тестов.',
				),
				scenario: [
					{ thought: 'Нужно вернуть maxDelay к 30 секундам. Сначала посмотрю файл, потом поправлю и прогоню тесты, а пуш потребует разрешения.' },
					{ plan: { steps: ['Прочитать retry.ts', 'Поправить maxDelay', 'Прогнать тесты', 'Запушить ветку'], statuses: ['in_progress', 'pending', 'pending', 'pending'] } },
					{
						text: 'Смотрю текущую политику ретраев. Сейчас она выглядит так:\n\n```ts\n' + RETRY_BEFORE + '\n```\n\nЗначение `3000` слишком мало для интеграционного теста.',
					},
					{
						tool: {
							name: 'read_file',
							kind: 'read',
							title: 'Read: src/net/retry.ts',
							input: { file_path: 'src/net/retry.ts' },
							output: RETRY_BEFORE + '\n\nexport function delayFor(n: number): number {\n\treturn Math.min(retryPolicy.maxDelay, retryPolicy.baseDelay * 2 ** n)\n}',
						},
					},
					{ plan: { steps: ['Прочитать retry.ts', 'Поправить maxDelay', 'Прогнать тесты', 'Запушить ветку'], statuses: ['completed', 'in_progress', 'pending', 'pending'] } },
					{
						tool: {
							name: 'edit',
							kind: 'edit',
							title: 'Edit: src/net/retry.ts',
							input: { file_path: 'src/net/retry.ts', old_string: RETRY_BEFORE, new_string: RETRY_AFTER },
							output: 'Файл обновлён: src/net/retry.ts',
						},
					},
					{ plan: { steps: ['Прочитать retry.ts', 'Поправить maxDelay', 'Прогнать тесты', 'Запушить ветку'], statuses: ['completed', 'completed', 'in_progress', 'pending'] } },
					{
						tool: {
							name: 'run_shell_command',
							kind: 'execute',
							title: 'Shell: npm run test:integration',
							input: { command: 'npm run test:integration' },
							output:
								'> shippy@2.4.0 test:integration\n> node --test test/integration\n\n✔ net/retry: бэкофф не превышает maxDelay (12 ms)\n✔ net/retry: повтор после 503 (48 ms)\n✔ sync/upload: большой файл (2104 ms)\n\ntests 14\npass 14\nfail 0\nduration_ms 2871',
						},
					},
					{ plan: { steps: ['Прочитать retry.ts', 'Поправить maxDelay', 'Прогнать тесты', 'Запушить ветку'], statuses: ['completed', 'completed', 'completed', 'in_progress'] } },
					{ ask: 'Shell: git push origin fix/retry-delay' },
					{
						tool: {
							name: 'run_shell_command',
							kind: 'execute',
							title: 'Shell: git push origin fix/retry-delay',
							input: { command: 'git push origin fix/retry-delay' },
							output: 'remote: To create a merge request for fix/retry-delay, visit:\nremote:   https://gitlab.example.com/shippy/-/merge_requests/512\nTo gitlab.example.com:shippy.git\n * [new branch]      fix/retry-delay -> fix/retry-delay',
						},
					},
					{ plan: { steps: ['Прочитать retry.ts', 'Поправить maxDelay', 'Прогнать тесты', 'Запушить ветку'], statuses: ['completed', 'completed', 'completed', 'completed'] } },
					{
						text: reply(
							'фикс запушен, MR открыт [1].',
							['`maxDelay` возвращён к 30 с, интеграционные тесты проходят (14 из 14) [2]'],
							['https://gitlab.example.com/shippy/-/merge_requests/512', '`shippy@fix/retry-delay:src/net/retry.ts:42`'],
						),
					},
				],
			},
			{
				name: 'ci-verifier',
				role: 'verifier',
				prompt: brief(
					'независимо проверить вывод ci-explorer о причине падения CI.',
					'explorer утверждает, что виноват коммит a1b2c3d, уменьшивший maxDelay.',
					'не доверять выводу на слово: сверить коммит и перезапустить job локально.',
					'подтверждено или нет, с доказательствами.',
				),
				scenario:
					'#work 3 Проверить вывод explorer => Read: ответ ci-explorer; Сверить коммит => Git: show a1b2c3d; Перезапустить job локально => Shell: npm run test:integration || ' +
					reply(
						'причина подтверждена: после отката `maxDelay` тест проходит [1][3].',
						['Коммит `a1b2c3d` действительно меняет `maxDelay` [2]'],
						['`npm run test:integration`', '`git show a1b2c3d`', '`shippy@a1b2c3d:src/net/retry.ts:42`'],
						'DONE_WITH_CONCERNS — флейки в соседнем тесте не проверены',
					),
			},
		],
	},
	{
		session: { id: 'demo-review-mr', title: 'Ревью MR !482 и отчёт в Jira', owner: 'claude-2' },
		space: 'nessy-orch',
		agents: [
			{
				name: 'mr-reviewer',
				role: 'gitlab-mr-reviewer',
				prompt: brief(
					'отревьюить MR !482 (рефанды в платёжном сервисе shop).',
					'MR добавляет метод refund() и новые эндпоинты, влить хотят сегодня.',
					'комментарии в GitLab не оставлять, только отчёт мне.',
					'вердикт «мержить / нельзя» и список замечаний со ссылками на строки.',
				),
				scenario:
					'#work~ 0 Получить diff MR => GitLab: MR !482 diff; Прочитать изменения => Read: src/payments/*.ts; Проверить тесты => Shell: npm test -- payments; Написать замечания => Think: замечания || ' +
					reply(
						'MR !482 можно мержить после двух правок [1].',
						['Нет проверки `amount <= 0` в `refund()` [2]', 'Тест на двойной возврат отсутствует [3]'],
						['https://gitlab.example.com/shop/-/merge_requests/482', '`shop@9f8e7d6:src/payments/refund.ts:57`', '`shop@9f8e7d6:test/payments/refund.test.ts`'],
					),
				// агент, запущенный этим агентом, наследует сессию
				children: [
					{
						name: 'sec-check',
						role: 'security-reviewer',
						prompt: brief(
							'проверить MR !482 на уязвимости во входных данных.',
							'эндпоинт возврата принимает сумму и id платежа из тела запроса.',
							'только чтение; сверяться с OWASP ASVS.',
							'список уязвимостей или явное «не найдено».',
						),
						scenario:
							'#work~ 1 Найти точки ввода => Grep: req.body; Проверить валидацию => Read: src/payments/validate.ts; Сверить с OWASP => Wiki: OWASP ASVS || ' +
							reply('уязвимостей не найдено, валидация суммы есть на входе [1].', ['Схема `RefundRequest` ограничивает `amount` [1]'], ['`shop@9f8e7d6:src/payments/validate.ts:12`', 'https://owasp.org/www-project-application-security-verification-standard/']),
					},
				],
			},
			{
				name: 'jira-writer',
				role: 'jira-analyst',
				prompt: brief(
					'оставить в SHOP-1203 комментарий с итогами ревью MR !482.',
					'ревью делает mr-reviewer, его вывод нужен до публикации.',
					'писать только в SHOP-1203, статус сессии не менять.',
					'ссылка на добавленный комментарий.',
				),
				scenario:
					'#work~ 1 Найти сессию в Jira => Jira: SHOP-1203; Собрать итоги ревью => Read: ответ mr-reviewer; Написать комментарий => Jira: comment SHOP-1203 || ' +
					reply('комментарий с итогами ревью добавлен в SHOP-1203 [1].', ['Указаны две обязательные правки [1]'], ['https://jira.example.com/browse/SHOP-1203']),
			},
		],
	},
]

async function spawn(spec, session, space, from) {
	const r = await api('POST', '/agents', {
		space,
		session: from ? undefined : session,
		from,
		name: spec.name,
		role: spec.role,
		prompt: spec.prompt,
	})
	if (r.status !== 201) throw new Error(`spawn ${spec.name}: ${r.body.error ?? r.status}`)
	console.log(`[demo-seed]   агент ${spec.name} (${r.body.agent.id}) → сессия ${r.body.agent.session}`)
	for (const child of spec.children ?? []) {
		await sleep(400)
		await spawn(child, session, space, r.body.agent.id)
	}
}

async function main() {
	await waitUp()
	const scenarios = {}
	const collect = a => {
		scenarios[a.prompt.split('\n')[0]] = a.scenario
		a.children?.forEach(collect)
	}
	SESSIONS.forEach(t => t.agents.forEach(collect))
	const home = process.env.NESSY_ORCH_HOME ?? path.join(os.homedir(), '.nessy-orch')
	fs.mkdirSync(home, { recursive: true })
	fs.writeFileSync(path.join(home, 'fake-scenarios.json'), JSON.stringify(scenarios, null, 2))
	const shippy = path.join(os.tmpdir(), 'nessy-orch-demo-ws', 'shippy')
	fs.mkdirSync(shippy, { recursive: true })
	await api('POST', '/spaces', { path: shippy, name: 'shippy' })
	await api('POST', '/spaces', { path: process.cwd(), name: 'nessy-orch' })
	const roles = new Set((await api('GET', '/roles')).body.map(r => r.id))
	for (const t of SESSIONS) {
		const r = await api('POST', '/sessions', t.session)
		if (r.status === 409) {
			console.log(`[demo-seed] сессия ${t.session.id} уже есть — пропускаю`)
			continue
		}
		if (r.status !== 201) throw new Error(`сессия ${t.session.id}: ${r.body.error ?? r.status}`)
		console.log(`[demo-seed] сессия ${r.body.id} (${t.session.owner}): nessy-orch://session/${r.body.id}`)
		const strip = a => ({ ...a, role: roles.has(a.role) ? a.role : undefined, children: a.children?.map(strip) })
		for (const a of t.agents) await spawn(strip(a), r.body.id, t.space)
	}
	console.log(`[demo-seed] готово: ${BASE}`)
}

main().catch(e => {
	console.error(`[demo-seed] ошибка: ${e instanceof Error ? e.message : String(e)}`)
	process.exit(1)
})
