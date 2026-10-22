#!/usr/bin/env node
// Демо-стенд фонового обучения (окно «Фон» приложения на моках). Запуск: `npm run demo:learning [-- --fresh]`.
// Готовит ${TMPDIR}/nessy-orch-demo-learning, заранее пишет кейсы, плейбуки, журнал, чаты и очередь через настоящие
// модули из dist/ (формат настоящий), поднимает сервер на 127.0.0.1:4399 с фейковым nessy и заводит две живые сессии:
// у одной сборщик «работает» (задание «Сейчас»), у другой отвечает сразу. Токен оператора берётся (только чтение) из
// ~/.nessy-orch/token — приложение, которое читает токен оттуда, пишет в демо-сервер. Ctrl+C останавливает сервер.
// Не трогает ~/.nessy-orch, службу на 4337 и ~/.claude: плагин плейбуков — внутри демо-каталога.
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const PORT = Number(process.env.DEMO_PORT ?? 4399)
const HOME = path.join(process.env.TMPDIR || os.tmpdir(), 'nessy-orch-demo-learning')
const FRESH = process.argv.includes('--fresh')

for (const f of ['src/main.js', 'test/support/fake-nessy.js', 'src/infrastructure/persistence/learning-store.js', 'src/infrastructure/persistence/playbook-store.js']) {
	if (!fs.existsSync(path.join(DIST, f))) {
		console.error(`[demo-learning] нет dist/${f}: сначала \`npm run build\``)
		process.exit(1)
	}
}
const { FileLearningStore } = await import(path.join(DIST, 'src/infrastructure/persistence/learning-store.js'))
const { FilePlaybookStore } = await import(path.join(DIST, 'src/infrastructure/persistence/playbook-store.js'))
const { renderPlaybook, addChangelog } = await import(path.join(DIST, 'src/domain/playbook-render.js'))

// ---------- каталог и токен ----------
const PLUGIN_DIR = path.join(HOME, 'claude', 'skills', 'nessy-playbooks')
const PROJECTS = path.join(HOME, 'claude-projects')
if (FRESH) fs.rmSync(HOME, { recursive: true, force: true })
const seeded = fs.existsSync(path.join(HOME, 'cases'))
fs.mkdirSync(HOME, { recursive: true })
try {
	const t = fs.readFileSync(path.join(os.homedir(), '.nessy-orch', 'token'), 'utf8').trim()
	fs.writeFileSync(path.join(HOME, 'token'), t + '\n', { mode: 0o600 })
} catch {
	console.warn('[demo-learning] ~/.nessy-orch/token не прочитан: сервер заведёт свой токен (приложение его не знает)')
}
const TOKEN = (() => {
	try {
		return fs.readFileSync(path.join(HOME, 'token'), 'utf8').trim()
	} catch {
		return ''
	}
})()

const NOW = Date.now()
const H = 3600_000
const D = 24 * H
const iso = ms => new Date(ms).toISOString()
const ago = ms => iso(NOW - ms)

// ---------- описания сессий в формате сборщика ----------
const range = a => (Array.isArray(a) ? `n ${a[0]}–${a[1]}` : `n ${a}`)
/** goal: {title, type, plan[], actions[[what, agent, result, anchor]], sources[], corrections[[proposed, user, anchor]], open[]} */
function summary(title, goals) {
	const out = [`# ${title}`]
	for (const g of goals) {
		out.push(`## Goal: ${g.title} (type: ${g.type})`, '### Plan', ...(g.plan?.length ? g.plan : ['- none']))
		out.push('### Actions', ...(g.actions?.length ? g.actions.map(([w, a, r, n]) => `- ${w} -> ${a} -> ${r} (${range(n)})`) : ['- none']))
		out.push('### Sources', ...(g.sources?.length ? g.sources.map(s => `- ${s}`) : ['- none']))
		out.push('### User corrections', ...(g.corrections?.length ? g.corrections.map(([p, u, n]) => `- Proposed: ${p}. User: "${u}" (${range(n)})`) : ['- none']))
		out.push('### Open questions', ...(g.open?.length ? g.open.map(o => `- ${o}`) : ['- none']))
	}
	return out.join('\n') + '\n'
}

// ---------- события кейсов ----------
/** list: [kind, who, text]; task — who это адресат, reply — отправитель; нумерация с 1, шаг ~40 с. */
function events(startMs, list) {
	return list.map(([kind, who, text], i) => ({
		n: i + 1,
		ts: startMs + i * 40_000,
		kind,
		from: kind === 'user' ? 'user' : kind === 'reply' ? who : kind === 'task' ? 'claude' : 'claude',
		to: kind === 'task' ? who : kind === 'reply' ? 'claude' : null,
		text,
		ref: kind === 'task' || kind === 'reply' ? `msg-${i + 1}` : `uuid-${i + 1}`,
	}))
}

const AFF_EVENTS = [
	['user', '', 'Реализуй пакет aff-geo по тикету AFF-412: справочник стран и регионов для affiliate-сервиса.'],
	['claude', '', 'Сначала посмотрю тикет и соседние пакеты, затем распределю работу по агентам.'],
	['skill', '', 'nessy-orch'],
	['task', 'ticket-reader', 'Цель: прочитать AFF-412 и связанные тикеты. Результат: требования списком.'],
	['reply', 'ticket-reader', '**Итог** — в AFF-412 нужен справочник из 249 стран и регионов, API `getRegion(code)`.\n\n**Источники**\n1. AFF-412\n\nСтатус: DONE'],
	['task', 'code-explorer', 'Цель: найти в монорепо соседние пакеты aff-* и их структуру. Результат: шаблон пакета.'],
	['reply', 'code-explorer', '**Итог** — соседи aff-currency и aff-lang; общая схема src/index.ts + test/.\n\n**Источники**\n1. packages/aff-currency\n\nСтатус: DONE'],
	['claude', '', 'План: скелет пакета, данные, API, тесты, MR. Предлагаю взять данные из ISO-3166 одним JSON.'],
	['user', '', 'Нет, не из ISO одним файлом — бери из нашего справочника в Wiki (пространство AFFDATA), там есть наши регионы.'],
	['task', 'executor-1', 'Цель: создать пакет packages/aff-geo со скелетом по образцу aff-currency.'],
	['reply', 'executor-1', '**Итог** — скелет создан, сборка проходит.\n\nСтатус: DONE'],
	['task', 'wiki-reader', 'Цель: выгрузить справочник стран из Wiki AFFDATA/Regions в JSON.'],
	['reply', 'wiki-reader', '**Итог** — выгружено 253 записи (249 + 4 наших региона).\n\n**Источники**\n1. Wiki AFFDATA/Regions\n\nСтатус: DONE'],
	['task', 'executor-1', 'Цель: реализовать getRegion(code) и загрузку данных, добавить тесты.'],
	['reply', 'executor-1', '**Итог** — API и 18 тестов готовы, проходят.\n\nСтатус: DONE'],
	['claude', '', 'Открою MR и отправлю на проверку верификатору.'],
	['user', '', 'MR сразу в ветку release, не в main. И не забудь CHANGELOG.'],
	['task', 'executor-1', 'Цель: открыть MR в release с записью в CHANGELOG.'],
	['reply', 'executor-1', '**Итог** — MR !917 открыт в release, CHANGELOG обновлён.\n\n**Источники**\n1. MR !917\n\nСтатус: DONE'],
	['task', 'verifier', 'Цель: независимо проверить MR !917: сборка, тесты, CHANGELOG.'],
	['reply', 'verifier', '**Итог** — подтверждено, замечаний нет.\n\nСтатус: DONE'],
	['user', '', 'Теперь отревьюй MR !918 коллеги по пакету aff-lang, только отчёт, комментарии не оставляй.'],
	['task', 'mr-reviewer', 'Цель: отревьюить MR !918 (aff-lang), комментарии не оставлять.'],
	['reply', 'mr-reviewer', '**Итог** — можно мержить после правки: нет теста на пустую локаль.\n\n**Источники**\n1. MR !918\n\nСтатус: DONE'],
]

const aff1 = [
	{
		title: 'Implement aff-geo package for AFF-412',
		type: 'implement package',
		plan: ['- Read ticket and neighbour packages, then scaffold `packages/aff-geo`, load data, add API and tests, open MR to `release`.'],
		actions: [
			['Read AFF-412 and linked tickets', 'ticket-reader, jira-analyst', 'requirements: 249 regions, `getRegion(code)`', 4],
			['Survey sibling packages aff-*', 'code-explorer, code-explorer', 'template: src/index.ts + test/', [6, 7]],
			['Scaffold packages/aff-geo', 'executor-1, executor', 'skeleton builds', [10, 11]],
			['Export region reference from Wiki AFFDATA', 'wiki-reader, wiki-reader', '253 records', [12, 13]],
			['Implement getRegion and loader, add tests', 'executor-1, executor', '18 tests pass', [14, 15]],
			['Open MR !917 into release with CHANGELOG', 'executor-1, executor', 'MR opened', [18, 19]],
			['Verify MR !917', 'verifier, verifier', 'confirmed, no findings', [20, 21]],
		],
		sources: ['Jira AFF-412', 'Wiki space AFFDATA, page Regions', 'packages/aff-currency, packages/aff-lang', 'MR !917'],
		corrections: [
			['Take country data from ISO-3166 as a single JSON file', 'not from ISO as one file, take it from our Wiki reference (AFFDATA), it has our regions', [8, 9]],
			['Open the MR into main', 'MR straight into release, not main. And do not forget CHANGELOG', [17, 17]],
		],
		open: ['Who updates the downstream aff-geo consumers after release is not stated'],
	},
	{
		title: 'Review colleague MR !918 (aff-lang)',
		type: 'review merge request',
		plan: ['- Report only: no comments in GitLab.'],
		actions: [['Review MR !918', 'mr-reviewer, gitlab-mr-reviewer', 'ok after one fix: no test for empty locale', [23, 24]]],
		sources: ['MR !918'],
		corrections: [['Leave review comments in GitLab', 'only the report, do not leave comments', [22, 22]]],
		open: [],
	},
]

const AFF2_EVENTS = [
	['user', '', 'Сделай пакет aff-tax по AFF-431, как делали aff-geo. Данные — из Wiki AFFDATA, MR в release.'],
	['skill', '', 'nessy-playbooks:aff-package'],
	['claude', '', 'Иду по плейбуку aff-package: тикет, соседи, скелет, данные, реализация, MR, проверка.'],
	['task', 'ticket-reader', 'Цель: прочитать AFF-431.'],
	['reply', 'ticket-reader', '**Итог** — нужны ставки налога по 40 странам, API `taxFor(country)`.\n\nСтатус: DONE'],
	['task', 'executor-1', 'Цель: создать пакет packages/aff-tax по образцу aff-geo.'],
	['reply', 'executor-1', '**Итог** — скелет создан.\n\nСтатус: DONE'],
	['task', 'wiki-reader', 'Цель: выгрузить ставки из Wiki AFFDATA/Tax.'],
	['reply', 'wiki-reader', '**Итог** — 40 записей.\n\nСтатус: DONE'],
	['task', 'executor-1', 'Цель: реализовать taxFor, тесты, MR в release с CHANGELOG.'],
	['reply', 'executor-1', '**Итог** — MR !931 открыт, тесты проходят.\n\nСтатус: DONE'],
	['user', '', 'Ставки округляй до двух знаков, а не до целых.'],
	['task', 'executor-1', 'Цель: округление до двух знаков в taxFor, обновить MR.'],
	['reply', 'executor-1', '**Итог** — исправлено, MR обновлён.\n\nСтатус: DONE'],
]
const aff2 = [
	{
		title: 'Implement aff-tax package for AFF-431',
		type: 'implement package',
		plan: ['- Followed playbook aff-package: ticket, scaffold, Wiki data, implement, MR into `release`.'],
		actions: [
			['Read AFF-431', 'ticket-reader, jira-analyst', '40 countries, `taxFor(country)`', [4, 5]],
			['Scaffold packages/aff-tax from aff-geo', 'executor-1, executor', 'skeleton ready', [6, 7]],
			['Export tax rates from Wiki AFFDATA/Tax', 'wiki-reader, wiki-reader', '40 records', [8, 9]],
			['Implement taxFor, tests, MR !931', 'executor-1, executor', 'MR opened into release', [10, 11]],
			['Switch rate rounding to two decimals', 'executor-1, executor', 'MR updated', [13, 14]],
		],
		sources: ['Jira AFF-431', 'Wiki space AFFDATA, page Tax', 'MR !931'],
		corrections: [['Round rates to integers', 'round rates to two decimals, not to integers', [12, 12]]],
		open: [],
	},
]

// длинное описание: 3 цели, десятки действий (200+ строк); якоря в пределах 180 событий
const LONG_EVENTS = Array.from({ length: 180 }, (_, i) => {
	const k = i % 6
	if (i === 0) return ['user', '', 'Ночью упал платёжный шлюз pay-gw: разберись, что случилось, найди виновника и подготовь постмортем.']
	if (k === 0) return ['user', '', `Уточнение ${i}: проверь ещё и узел pay-gw-${(i % 7) + 1}, у него похожие симптомы.`]
	if (k === 1) return ['claude', '', `Проверяю узел pay-gw-${(i % 7) + 1}: логи, метрики, деплои за сутки.`]
	if (k === 2 || k === 4) return ['task', `explorer-${(i % 5) + 1}`, `Цель: собрать логи и метрики по pay-gw-${(i % 7) + 1} за окно инцидента.`]
	return ['reply', `explorer-${(i % 5) + 1}`, `**Итог** — по pay-gw-${(i % 7) + 1} найдено ${i % 9 + 1} аномалий, источник — лог и график.\n\nСтатус: DONE`]
})
const mkAct = (n0, count, what, agent, result) =>
	Array.from({ length: count }, (_, i) => [`${what} #${i + 1}`, `${agent}-${(i % 5) + 1}, ${agent === 'explorer' ? 'code-explorer' : 'analyst'}`, `${result} ${i + 1}`, [n0 + i * 2, n0 + i * 2 + 1]])
const longGoals = [
	{
		title: 'Find the cause of the pay-gw outage',
		type: 'investigate incident',
		plan: Array.from({ length: 12 }, (_, i) => `- Step ${i + 1}: ${['check deploys', 'read gateway logs', 'compare node metrics', 'inspect DB connections', 'trace retries', 'check queue depth', 'inspect TLS renewals', 'compare with last week', 'review config diffs', 'check upstream status', 'replay traffic', 'confirm root cause'][i]}.`),
		actions: mkAct(2, 64, 'Collect logs and metrics for a gateway node', 'explorer', 'anomalies found'),
		sources: Array.from({ length: 14 }, (_, i) => `Grafana dashboard pay-gw-${i + 1}, Kibana index pay-gw-*-${i + 1}`),
		corrections: Array.from({ length: 6 }, (_, i) => [`Check only node pay-gw-${i + 1}`, `check pay-gw-${i + 2} too, the symptoms are the same`, [i * 6 + 1, i * 6 + 1]]),
		open: ['Why the autoscaler did not add nodes is unknown', 'Whether the DB failover was triggered by the same cause'],
	},
	{
		title: 'Identify the commit that caused it',
		type: 'investigate incident',
		plan: ['- Bisect deploys of pay-gw over the last 48 hours.', '- Confirm by reverting the suspect in staging.'],
		actions: mkAct(40, 40, 'Check deploy and diff', 'analyst', 'suspect narrowed'),
		sources: Array.from({ length: 6 }, (_, i) => `Deploy log entry ${i + 1}`),
		corrections: [['Blame the latest deploy', 'the latest deploy is innocent, look at the config rollout before it', [43, 43]]],
		open: ['Confirmation in staging pending'],
	},
	{
		title: 'Write the postmortem',
		type: 'write postmortem',
		plan: ['- Timeline, impact, root cause, actions; in the team template.'],
		actions: mkAct(70, 30, 'Draft a postmortem section', 'analyst', 'section drafted'),
		sources: ['Postmortem template (Wiki OPS/Postmortem)', 'Jira INC-5521'],
		corrections: [['Use the free-form template', 'only the team template from OPS/Postmortem', [88, 88]]],
		open: ['Owner of the follow-up actions is not assigned'],
	},
]

// «грязное» описание: текст до первой цели, неизвестные разделы и продолжения пунктов — блоками не показать (editable = false)
const DIRTY_SUMMARY = `# Migrate the reports schema

Imported manually from the old notebook. Treat anchors below as approximate.

## Goal: Migrate reports schema to v3 (type: migrate schema)
Context: the reports service reads from two tables during the migration.
### Plan
- Add the v3 tables next to v1.
- Dual-write for one release, then switch reads.
### Actions
- Add v3 tables -> db-agent, executor -> migration 0042 applied (n 3–5)
  continuation: the rollback script is in the same MR
- Dual-write in the service -> exec-2, executor -> flag \`reports.v3\` added (n 6–9)
### Risks
- Long lock on \`reports_v1\` during the backfill.
- The old BI export reads v1 directly.
### Sources
- Wiki DATA/ReportsSchema
- MR !640
### User corrections
- Proposed: Switch reads right away. User: "dual-write for one release first, the BI export breaks otherwise" (n 7)
### Open questions
- none
## Appendix
Leftovers from the notebook, not a goal.
`

// ---------- плейбуки ----------
const stage = (n, slug, title, role, where, produce, done, gate, template) => ({ n, slug, title, role, where, produce, done, gate, template })
const rule = (id, text, stg, status, up, down, ev, against = [], created = 6 * D) => ({
	id, text, stage: stg, status, up, down,
	evidence: ev.map(([caseId, anchor]) => ({ caseId, anchor })),
	against: against.map(([caseId, anchor]) => ({ caseId, anchor })),
	lastAppliedAt: status === 'active' ? ago(2 * H + up * 1000) : null,
	createdAt: ago(created),
})
const base = (id, over) => ({
	id, name: id.slice(2), title: id, description: '', taskType: '', status: 'draft', version: 1, cases: [], heldOut: null,
	params: [], sources: [], files: [], behavior: [], stages: [], rules: [], trial: null, pendingEdits: [],
	createdAt: ago(8 * D), updatedAt: ago(1 * D), verdicts: {}, rejectedEdits: [], reviewAttempts: 0, ...over,
})
/** Небольшой плейбук по шаблону: n этапов, правила из массива. */
function small(id, over, stageDefs, rules) {
	return base(id, {
		...over,
		stages: stageDefs.map(([title, role, produce, gate], i) =>
			stage(i + 1, title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), title, role, 'the ticket, the repository', produce, `${produce} is reported`, gate, `Goal: ${title.toLowerCase()} for {ticket}.\nResult: ${produce}.`),
		),
		rules,
	})
}

const AFF_STAGES = [
	stage(1, 'read-ticket', 'Read the ticket', 'jira-analyst', 'Jira ticket and linked tickets', 'requirements as a short list', 'every requirement is listed with its ticket key', false, 'Goal: read {ticket} and linked tickets.\nContext: package {package}.\nLimits: read only.\nResult: requirements as a list.'),
	stage(2, 'survey-siblings', 'Survey sibling packages', 'code-explorer', 'packages/aff-*', 'a package template: structure and conventions', 'the template names every file a new package needs', false, 'Goal: survey packages/aff-* and describe the common layout.\nLimits: read only; clone nothing.\nResult: template of {package}.'),
	stage(3, 'scaffold', 'Scaffold the package', 'executor', 'packages/{package}', 'a package skeleton that builds', 'the build passes on the empty skeleton', false, 'Goal: create packages/{package} from the template.\nLimits: only this directory.\nResult: skeleton, build output.'),
	stage(4, 'load-data', 'Load the data', 'wiki-reader', 'Wiki space AFFDATA', 'the data as JSON in the package', 'record count matches the Wiki page', true, 'Goal: export {data_page} from Wiki AFFDATA to JSON.\nResult: JSON file and the record count.'),
	stage(5, 'implement', 'Implement API and tests', 'executor', 'packages/{package}/src', 'the API and tests, all passing', 'tests pass and CHANGELOG has an entry', false, 'Goal: implement the API of {ticket} and tests.\nLimits: no new dependencies.\nResult: diff and test output.'),
	stage(6, 'merge-request', 'Open and verify the MR', 'verifier', 'GitLab', 'an MR into `release` and an independent check', 'the verifier confirms build, tests and CHANGELOG', false, 'Goal: open an MR into `release`; then verify it independently.\nResult: MR link and the verdict.'),
]
const AFF_RULES = [
	rule('r-1', 'Take reference data from the team Wiki space AFFDATA, not from public datasets.', 4, 'active', 4, 0, [['c-demo-aff-pkg', 'n 8–9']]),
	rule('r-2', 'Open the MR into `release`, never into `main`.', 6, 'active', 3, 0, [['c-demo-aff-pkg', 'n 17'], ['c-demo-aff-pkg-2', 'n 10–11']]),
	rule('r-3', 'Add a CHANGELOG entry in every package MR.', 5, 'active', 3, 1, [['c-demo-aff-pkg', 'n 17'], ['c-demo-backfill', 'n 5']], [['c-demo-aff-pkg-2', 'n 10']]),
	rule('r-4', 'Round rates and amounts to two decimals.', 5, 'active', 2, 0, [['c-demo-aff-pkg-2', 'n 12']]),
	rule('r-5', 'For a review of a colleague MR, write only the report: no comments in GitLab.', null, 'active', 2, 0, [['c-demo-aff-pkg', 'n 22']]),
	rule('r-6', 'Ask which Wiki page holds the data before scaffolding when the ticket does not name it.', 3, 'candidate', 1, 0, [['c-demo-backfill', 'n 3–4']]),
	rule('r-7', 'Run the verifier on every MR, not only on large ones.', 6, 'candidate', 1, 0, [['c-demo-aff-pkg', 'n 20–21']]),
	rule('r-8', 'Show the loaded data to the user before implementing.', 4, 'candidate', 0, 1, [['c-demo-aff-pkg-2', 'n 8–9']], [['c-demo-aff-pkg', 'n 12–13']]),
	rule('r-9', 'Use ISO-3166 as the single source of countries.', 4, 'archived', 0, 3, [['c-demo-aff-pkg', 'n 8']], [['c-demo-aff-pkg', 'n 9']], 9 * D),
]

// версии активного плейбука: v1 (4 этапа, 3 правила) → v2 (6 этапов) → v3 (текущая)
const AFF_ACTIVE = base('p-aff-package', {
	name: 'aff-package',
	title: 'Implement an aff package from a Jira ticket',
	description: 'Use when asked to implement a new aff-* package from a Jira ticket: read the ticket, scaffold the package from siblings, load reference data from Wiki AFFDATA, implement and test the API, open and verify an MR into release.',
	taskType: 'implement package',
	status: 'active',
	version: 3,
	cases: ['c-demo-aff-pkg', 'c-demo-aff-pkg-2', 'c-demo-backfill'],
	params: [
		{ name: 'ticket', description: 'Jira key of the package ticket', source: 'the first user message' },
		{ name: 'package', description: 'package name without the aff- prefix', source: 'ticket title' },
		{ name: 'data_page', description: 'Wiki page with the reference data', source: 'ticket description or Wiki AFFDATA' },
	],
	sources: ['Jira ticket and linked tickets', 'Wiki space AFFDATA', 'packages/aff-currency, packages/aff-lang, packages/aff-geo', 'GitLab merge requests'],
	files: ['packages/aff-*/src/index.ts', 'packages/aff-*/test/', 'packages/aff-*/CHANGELOG.md'],
	behavior: ['Show the loaded data to the user at the data stage before implementing.', 'Never push to `main`; MRs go into `release`.', 'Run independent agents in parallel: ticket reading and the sibling survey.'],
	tools: [
		{
			name: 'normalize-rates.mjs',
			description: 'Round rates and amounts of a JSON array to two decimals; usage: `node tools/normalize-rates.mjs rates.json > rates.normalized.json`',
			content: [
				'#!/usr/bin/env node',
				"import { readFileSync } from 'node:fs'",
				"const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'))",
				'const round = v => (typeof v === \'number\' ? Math.round(v * 100) / 100 : v)',
				"const out = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, /rate|amount/i.test(k) ? round(v) : v])))",
				'console.log(JSON.stringify(out, null, 2))',
				'',
			].join('\n'),
		},
		{
			name: 'fetch-ticket.sh',
			description: 'Print the Jira ticket and its linked tickets as markdown; usage: `bash tools/fetch-ticket.sh AFF-412`',
			content: [
				'#!/bin/sh',
				'set -eu',
				'key="${1:?ticket key, for example AFF-412}"',
				'nessy-orch ask --role jira-analyst "Print ticket $key and linked tickets as markdown: key, title, description, acceptance criteria"',
				'',
			].join('\n'),
		},
	],
	stages: AFF_STAGES,
	rules: AFF_RULES,
	createdAt: ago(9 * D),
	updatedAt: ago(5 * H),
	verdicts: {
		'c-demo-aff-pkg': [
			{ ruleId: 'r-1', verdict: 'violated_by_user_correction', anchor: 'n 8–9' },
			{ ruleId: 'r-2', verdict: 'violated_by_user_correction', anchor: 'n 17' },
			{ ruleId: 'r-5', verdict: 'applied', anchor: 'n 22–24' },
		],
		'c-demo-aff-pkg-2': [
			{ ruleId: 'r-1', verdict: 'applied', anchor: 'n 8–9' },
			{ ruleId: 'r-2', verdict: 'applied', anchor: 'n 10–11' },
			{ ruleId: 'r-4', verdict: 'violated_by_user_correction', anchor: 'n 12' },
		],
	},
})
const AFF_V1 = { ...AFF_ACTIVE, tools: [], version: 1, stages: AFF_STAGES.slice(0, 4).map(s => ({ ...s, gate: false })), rules: AFF_RULES.slice(0, 3).map(r => ({ ...r, up: 1, down: 0 })), cases: ['c-demo-aff-pkg'], behavior: ['Never push to `main`.'], updatedAt: ago(9 * D) }
const AFF_V2 = { ...AFF_ACTIVE, version: 2, rules: AFF_RULES.slice(0, 5).map(r => ({ ...r, up: Math.max(1, r.up - 1) })), cases: ['c-demo-aff-pkg', 'c-demo-aff-pkg-2'], updatedAt: ago(3 * D) }

const AFF_NOTES = `# Notes

- Ticket keys for packages look like AFF-4xx; the Wiki page is named after the package.
- If the Wiki export has fewer records than the ticket says, ask before implementing.
- Do not touch \`packages/aff-legacy\`: it is frozen.
`

const PLAYBOOKS = [
	AFF_ACTIVE,
	small(
		'p-mr-review',
		{
			name: 'mr-review', title: 'Review a merge request and report to the ticket', taskType: 'review merge request', status: 'trial', version: 2, cases: ['c-demo-mr-1', 'c-demo-mr-2'],
			description: 'Use when asked to review a GitLab merge request and report the verdict: read the diff, run tests, check security-sensitive input, write a report.',
			params: [{ name: 'mr', description: 'merge request number', source: 'the user message' }],
			sources: ['GitLab MR', 'Jira ticket of the MR'], files: ['the files changed in the MR'], behavior: ['Do not leave comments in GitLab unless asked.'],
			trial: { before: 2.5, cases: ['c-demo-mr-3'], corrections: [1] }, updatedAt: ago(1 * D),
		},
		[['Read the diff', 'gitlab-mr-reviewer', 'a list of changed files with risks', false], ['Check input handling', 'security-reviewer', 'findings or an explicit none', false], ['Write the verdict', 'jira-analyst', 'merge / do not merge with line links', true]],
		[
			rule('r-1', 'Give the verdict first, then the findings with line links.', 3, 'active', 2, 0, [['c-demo-mr-1', 'n 5'], ['c-demo-mr-2', 'n 6']]),
			rule('r-2', 'Run the unit tests of the touched package before the verdict.', 1, 'candidate', 1, 0, [['c-demo-mr-2', 'n 4']]),
		],
	),
	small(
		'p-incident-triage',
		{
			name: 'incident-triage', title: 'Triage an incident and write a postmortem', taskType: 'investigate incident', status: 'review', version: 1, cases: ['c-demo-incident-long', 'c-demo-dirty', 'c-demo-mr-1'], heldOut: 'c-demo-mr-1',
			description: 'Use when a production service went down and the user asks for the cause and a postmortem: collect logs and metrics per node, find the suspect deploy, confirm in staging, write the postmortem in the team template.',
			params: [{ name: 'service', description: 'the failed service', source: 'the first user message' }],
			sources: ['Grafana', 'Kibana', 'Deploy log', 'Wiki OPS/Postmortem'], files: [], behavior: ['Check every node named by the user, not only the first.'],
			reviewAttempts: 1, updatedAt: ago(4 * H),
		},
		[['Collect evidence', 'code-explorer', 'logs and metrics per node', false], ['Find the suspect deploy', 'analyst', 'a ranked list of deploys', false], ['Confirm in staging', 'executor', 'a reproduction', true], ['Write the postmortem', 'analyst', 'a postmortem in the team template', false]],
		[rule('r-1', 'Look at the config rollout before the latest deploy.', 2, 'candidate', 0, 0, [['c-demo-incident-long', 'n 43']]), rule('r-2', 'Use only the team postmortem template.', 4, 'candidate', 0, 0, [['c-demo-incident-long', 'n 88']])],
	),
	small(
		'p-release-notes',
		{
			name: 'release-notes', title: 'Prepare release notes from merged MRs', taskType: 'write release notes', status: 'active', version: 2, cases: ['c-demo-mr-1', 'c-demo-mr-2', 'c-demo-mr-3'],
			description: 'Use when asked to prepare release notes: list merged MRs since the last tag, group by area, write notes for users.',
			params: [{ name: 'tag', description: 'previous release tag', source: 'git tags' }], sources: ['GitLab MRs', 'git tags'], files: ['CHANGELOG.md'], behavior: [],
			updatedAt: ago(7 * H),
			pendingEdits: [
				{ hash: 'e1a9c0de', file: 'stages/02-group-by-area.md', before: 'Group the MRs by area.', after: 'Group the MRs by area and put breaking changes first.', anchor: 'n 6–7', caseId: 'c-demo-mr-3', createdAt: ago(5 * H) },
				{ hash: 'f3b7a1c2', file: 'rules.md', before: 'Write notes in the past tense.', after: 'Write notes in the present tense, one sentence per change.', anchor: 'n 9', caseId: 'c-demo-mr-3', createdAt: ago(5 * H) },
			],
		},
		[['List merged MRs', 'gitlab-mr-reviewer', 'MRs since the tag', false], ['Group by area', 'analyst', 'MRs grouped by area', false], ['Write the notes', 'analyst', 'release notes', true]],
		[rule('r-1', 'Write notes in the past tense.', 3, 'active', 2, 0, [['c-demo-mr-1', 'n 8']])],
	),
	small(
		'p-jira-triage',
		{ name: 'jira-triage', title: 'Triage new Jira tickets', taskType: 'triage tickets', status: 'draft', version: 1, cases: ['c-demo-dirty', 'c-demo-incident-long'], description: 'Use when asked to triage new tickets of a Jira project: classify, set priority, assign.', params: [{ name: 'project', description: 'Jira project key', source: 'the user message' }], sources: ['Jira'], updatedAt: ago(2 * H) },
		[['Fetch new tickets', 'jira-analyst', 'a list of new tickets', false], ['Classify and prioritize', 'jira-analyst', 'a table ticket / class / priority', true]],
		[],
	),
	small(
		'p-wiki-sync',
		{ name: 'wiki-sync', title: 'Sync a Wiki page with the repository README', taskType: 'sync wiki', status: 'disabled', version: 1, cases: ['c-demo-dirty', 'c-demo-backfill', 'c-demo-mr-2'], description: 'Use when asked to bring a Wiki page in line with a README.', params: [{ name: 'page', description: 'Wiki page', source: 'the user message' }], sources: ['Wiki', 'README'], updatedAt: ago(2 * D) },
		[['Compare', 'wiki-reader', 'a diff of the page and README', false], ['Update the page', 'wiki-writer', 'the updated page', true]],
		[rule('r-1', 'Keep Wiki headings as they are.', 2, 'active', 1, 2, [['c-demo-dirty', 'n 2']], [['c-demo-backfill', 'n 7']])],
	),
	small(
		'p-old-deploy',
		{ name: 'old-deploy', title: 'Deploy the legacy billing job', taskType: 'deploy job', status: 'archived', version: 1, cases: ['c-demo-dirty', 'c-demo-mr-1', 'c-demo-mr-2'], description: 'Use when asked to deploy the legacy billing job by hand.', sources: ['Runbook'], updatedAt: ago(6 * D) },
		[['Deploy', 'executor', 'a running job', true]],
		[],
	),
]

// ---------- кейсы ----------
const caseBase = {
	title: null, sessions: [], status: 'ready', goals: [], events: 0, coveredUntil: 0, closedAt: null, playbook: null, source: 'live',
	feedSeq: 0, transcripts: {}, nextN: 1, lastEventAt: 0, lastRunAt: 0, nessyCalls: false, hinted: [],
}
function mkCase(id, o) {
	const created = NOW - o.startedAgo
	const evs = o.events ?? []
	const last = evs.length ? evs[evs.length - 1].ts : created
	const goals = o.goalsMeta ?? []
	return {
		...caseBase, id, title: o.title, sessions: o.sessions ?? [`s-${id.slice(2)}`], status: o.status ?? 'ready', goals,
		events: evs.length, coveredUntil: o.covered ?? evs.length, createdAt: iso(created), updatedAt: iso(o.updatedAgo !== undefined ? NOW - o.updatedAgo : last + 60_000),
		closedAt: (o.status ?? 'ready') === 'ready' ? iso(last + 5 * 60_000) : null, playbook: o.playbook ?? null, source: o.source ?? 'live',
		feedSeq: evs.length, nextN: evs.length + 1, lastEventAt: last, lastRunAt: last + 120_000, rootId: o.sessions?.[0] ?? `s-${id.slice(2)}`,
		nessyCalls: o.source === 'backfill', transcripts: o.transcripts ?? {},
	}
}
const goalsOf = gs => gs.map(g => ({ title: g.title, type: g.type }))

/** Простой кейс по шаблону: один агент, ответ и поправка. */
function simpleMr(n, title, type, agentCases) {
	const evs = events(NOW - agentCases * H, [
		['user', '', `Отревьюй MR !${480 + n} (платёжный сервис), вердикт и замечания мне.`],
		['claude', '', 'Читаю diff и запускаю проверки.'],
		['task', 'mr-reviewer', `Цель: отревьюить MR !${480 + n}.`],
		['reply', 'mr-reviewer', '**Итог** — можно мержить после правки.\n\n**Источники**\n1. MR\n\nСтатус: DONE'],
		['user', '', 'Вердикт напиши первой строкой, а замечания ниже со ссылками на строки.'],
		['task', 'jira-writer', 'Цель: записать итог ревью в тикет.'],
		['reply', 'jira-writer', '**Итог** — комментарий добавлен.\n\nСтатус: DONE'],
		['claude', '', 'Готово.'],
	])
	const g = [{ title, type, plan: ['- Review the MR and write the verdict into the ticket.'], actions: [['Review the MR', 'mr-reviewer, gitlab-mr-reviewer', 'ok after one fix', [3, 4]], ['Write the verdict into the ticket', 'jira-writer, jira-analyst', 'comment added', [6, 7]]], sources: [`MR !${480 + n}`], corrections: [['Findings first, verdict at the end', 'verdict as the first line, findings below with line links', [5, 5]]], open: [] }]
	return { evs, g }
}

function build() {
	const learning = new FileLearningStore(HOME, ROOT)
	const pbs = new FilePlaybookStore(HOME, PLUGIN_DIR)
	const caseDefs = []
	const put = (id, o, evs, goals, notes, summaryText, goalsMeta) => caseDefs.push({ id, o, evs, goals, notes, summaryText, goalsMeta })

	put('c-demo-aff-pkg', { title: 'Package aff-geo for AFF-412', startedAgo: 2 * D + 5 * H, playbook: 'p-aff-package@2', sessions: ['s-aff-geo'] }, events(NOW - 2 * D - 5 * H, AFF_EVENTS), aff1, 'Remember: AFFDATA is the source of truth for regions.\n', summary('Package aff-geo for AFF-412', aff1))
	put('c-demo-aff-pkg-2', { title: 'Package aff-tax for AFF-431', startedAgo: 1 * D + 6 * H, playbook: 'p-aff-package@3', sessions: ['s-aff-tax'] }, events(NOW - 1 * D - 6 * H, AFF2_EVENTS), aff2, null, summary('Package aff-tax for AFF-431', aff2))
	put('c-demo-incident-long', { title: 'pay-gw outage: cause and postmortem', startedAgo: 1 * D + 2 * H, sessions: ['s-pay-gw'] }, events(NOW - 1 * D - 2 * H, LONG_EVENTS), longGoals, null, summary('pay-gw outage: cause and postmortem', longGoals))
	put('c-demo-dirty', { title: 'Migrate the reports schema', startedAgo: 3 * D, sessions: ['s-reports-schema'] }, events(NOW - 3 * D, [['user', '', 'Мигрируй схему отчётов на v3.'], ['claude', '', 'Начну с таблиц.'], ['task', 'db-agent', 'Цель: добавить таблицы v3.'], ['reply', 'db-agent', '**Итог** — миграция 0042 применена.\n\nСтатус: DONE'], ['claude', '', 'Откат в том же MR.'], ['task', 'exec-2', 'Цель: двойная запись в сервисе.'], ['reply', 'exec-2', '**Итог** — флаг reports.v3 добавлен.\n\nСтатус: DONE'], ['user', '', 'Двойная запись минимум на один релиз, иначе BI-выгрузка упадёт.'], ['reply', 'exec-2', '**Итог** — ок.\n\nСтатус: DONE'], ['claude', '', 'Готово.']]), null, null, DIRTY_SUMMARY, [{ title: 'Migrate reports schema to v3', type: 'migrate schema' }])
	for (const [i, h] of [[1, 20], [2, 12], [3, 3]]) {
		const m = simpleMr(i, `Review MR !${480 + i}`, 'review merge request', h)
		put(`c-demo-mr-${i}`, { title: `Review MR !${480 + i}`, startedAgo: h * H, playbook: i === 3 ? 'p-mr-review@2' : null, sessions: [`s-mr-${i}`] }, m.evs, m.g, null, summary(`Review MR !${480 + i}`, m.g))
	}
	// backfill (разобран задним числом, по транскрипту)
	const bfEvs = events(NOW - 4 * D, [
		['user', '', 'Сделай пакет aff-lang по AFF-390, данные из Wiki AFFDATA/Lang.'],
		['call', '', 'nessy-orch spawn --role jira-analyst --name t1 "прочитать AFF-390"'],
		['claude', '', 'Тикет прочитан: 12 языков.'],
		['call', '', 'nessy-orch spawn --role executor --name e1 "скелет packages/aff-lang"'],
		['claude', '', 'Скелет создан, MR в release.'],
		['user', '', 'В CHANGELOG запись обязательна.'],
		['call', '', 'nessy-orch send e1 "добавь запись в CHANGELOG"'],
		['claude', '', 'Готово.'],
	])
	const bfG = [{ title: 'Implement aff-lang package for AFF-390', type: 'implement package', plan: ['- Scaffold from the ticket; data from Wiki; MR into release.'], actions: [['Read AFF-390', 'jira-analyst', '12 languages', [2, 3]], ['Scaffold aff-lang and open MR', 'e1, executor', 'MR into release', [4, 5]], ['Add CHANGELOG entry', 'e1, executor', 'entry added', [7, 8]]], sources: ['Jira AFF-390', 'Wiki AFFDATA/Lang'], corrections: [['MR without CHANGELOG', 'a CHANGELOG entry is mandatory', [6, 6]]], open: [] }]
	put('c-demo-backfill', { title: 'Package aff-lang for AFF-390', startedAgo: 4 * D, source: 'backfill', sessions: [], playbook: 'p-aff-package@1', transcripts: { 'demo-chat-lang': { path: path.join(PROJECTS, 'demo-project', 'demo-chat-lang.jsonl'), offset: 1024 } } }, bfEvs, bfG, 'Imported from the transcript of 4 days ago.\n', summary('Package aff-lang for AFF-390', bfG))
	// collecting: сборщик ещё не дошёл до конца
	const colEvs = events(NOW - 40 * 60_000, [['user', '', 'Подготовь отчёт по расходам на CI за квартал.'], ['claude', '', 'Соберу данные по пайплайнам.'], ['task', 'analyst-1', 'Цель: выгрузить минуты CI по проектам за квартал.'], ['reply', 'analyst-1', '**Итог** — выгружено 31 проект.\n\nСтатус: DONE'], ['user', '', 'Минуты в деньги переведи по тарифу 0,008 за минуту.'], ['task', 'analyst-1', 'Цель: посчитать расходы по тарифу.'], ['reply', 'analyst-1', '**Итог** — итого 14 280.\n\nСтатус: DONE']])
	const colG = [{ title: 'CI cost report for the quarter', type: 'prepare report', plan: ['- Export CI minutes per project, convert to money.'], actions: [['Export CI minutes', 'analyst-1, analyst', '31 projects', [3, 4]]], sources: ['GitLab CI statistics'], corrections: [], open: ['Rate for converting minutes is not confirmed yet'] }]
	put('c-demo-collecting', { title: 'Отчёт по расходам на CI', status: 'collecting', startedAgo: 45 * 60_000, covered: 4, sessions: ['s-ci-cost'], updatedAgo: 10 * 60_000 }, colEvs, colG, null, summary('CI cost report', colG))
	const clEvs = events(NOW - 3 * H, [['user', '', 'Обнови зависимости в shippy.'], ['task', 'executor-1', 'Цель: обновить зависимости.'], ['reply', 'executor-1', '**Итог** — обновлено 12.\n\nСтатус: DONE'], ['user', '', 'Мажорные версии не трогай.'], ['task', 'executor-1', 'Цель: откатить мажорные.'], ['reply', 'executor-1', '**Итог** — откатил 2.\n\nСтатус: DONE']])
	const clG = [{ title: 'Update dependencies in shippy', type: 'update dependencies', plan: ['- Update everything except major versions.'], actions: [['Update dependencies', 'executor-1, executor', '12 updated', [2, 3]]], sources: ['shippy/package.json'], corrections: [['Update all', 'do not touch major versions', [4, 4]]], open: [] }]
	put('c-demo-closing', { title: 'Update dependencies in shippy', status: 'closing', startedAgo: 3 * H, covered: 3, sessions: ['s-shippy-deps'], updatedAgo: 90_000 }, clEvs, clG, null, summary('Update dependencies in shippy', clG))
	const erEvs = events(NOW - 6 * H, [['user', '', 'Разберись с флейками в e2e.'], ['task', 'explorer-1', 'Цель: найти флейкающие тесты.'], ['reply', 'explorer-1', '**Итог** — 5 тестов.\n\nСтатус: DONE'], ['claude', '', 'Готово.']])
	put('c-demo-error', { title: 'Флейки в e2e-тестах', status: 'closing', startedAgo: 6 * H, covered: 0, sessions: ['s-e2e'], updatedAgo: 25 * 60_000 }, erEvs, [], null, '', [])


	// запись
	for (const c of caseDefs) {
		learning.writeSummary(c.id, c.summaryText)
		if (c.notes) learning.writeNotes(c.id, c.notes)
		const state = mkCase(c.id, { ...c.o, events: c.evs, goalsMeta: c.goalsMeta ?? goalsOf(c.goals ?? []) })
		learning.saveCase(state)
		learning.appendRaw(c.id, c.evs)
	}

	// плейбуки
	const writeVersions = (p, versions) => {
		let changelog = ''
		versions.forEach((v, i) => {
			changelog = addChangelog(changelog, i + 1, iso(NOW - (versions.length - i) * 2 * D).slice(0, 10), v.notes)
			pbs.savePlaybook({ ...v.state, version: i + 1 }, renderPlaybook({ ...v.state, version: i + 1 }, p === AFF_ACTIVE ? AFF_NOTES : '', changelog), v.message)
		})
	}
	writeVersions(AFF_ACTIVE, [
		{ state: AFF_V1, message: 'Initial playbook from the case c-demo-aff-pkg', notes: ['Playbook created from 1 case', '4 stages, 3 rules'] },
		{ state: AFF_V2, message: 'Add stages 5–6 and rounding rule', notes: ['Stages: implement, merge request', 'Rule: round to two decimals'] },
		{ state: AFF_ACTIVE, message: 'Add rules from c-demo-aff-pkg-2 and data gate', notes: ['Gate on the data stage', 'Rule r-8 as a candidate', 'r-9 archived: ISO-3166 was rejected twice'] },
	])
	pbs.writeNotes('p-aff-package', AFF_NOTES)
	for (const p of PLAYBOOKS.slice(1)) {
		const notes = p.id === 'p-mr-review' ? '# Notes\n\nSecurity check is mandatory for payment code.\n' : ''
		const versions = p.version
		for (let v = 1; v <= versions; v++) pbs.savePlaybook({ ...p, version: v }, renderPlaybook({ ...p, version: v }, notes, addChangelog('', v, iso(NOW - (versions - v + 1) * D).slice(0, 10), [v === 1 ? 'Initial version' : 'Refined stages'])), v === 1 ? 'Initial version' : 'Refine stages')
		if (notes) pbs.writeNotes(p.id, notes)
	}

	// ревью: review (критичная ступень 2), активный и пробный прошли
	const stagesOf = (verdicts, crit = {}) => verdicts.map((v, i) => ({ stage: i + 1, verdict: v, critical: crit[i + 1] ?? [], notes: v === 'pass' ? ['Checked against the cases: consistent.'] : v === 'skip' ? ['Skipped: no held-out case.'] : [], agentIds: [`a-demo-${i + 1}`] }))
	pbs.saveReview({ playbookId: 'p-incident-triage', version: 1, ts: ago(4 * H), passed: false, stages: stagesOf(['pass', 'fail', 'pass', 'pass', 'skip', 'pass'], { 2: ['The stage "Find the suspect deploy" does not say where the deploy log lives: an agent cannot start from it.', 'The rule about the config rollout contradicts the stage order: the rollout is checked after the deploys.'] }) })
	pbs.saveReview({ playbookId: 'p-aff-package', version: 3, ts: ago(5 * H), passed: true, stages: stagesOf(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']) })
	pbs.saveReview({ playbookId: 'p-aff-package', version: 2, ts: ago(3 * D), passed: true, stages: stagesOf(['pass', 'pass', 'pass', 'pass', 'skip', 'pass']) })
	pbs.saveReview({ playbookId: 'p-mr-review', version: 2, ts: ago(1 * D), passed: true, stages: stagesOf(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']) })

	// журнал: 3 дня, все виды
	const J = []
	const j = (agoMs, kind, subject, text, report = null, revertible = false) => J.push({ id: `j-${String(J.length + 1).padStart(3, '0')}`, ts: ago(agoMs), kind, subject, summary: text, report: report === null ? null : JSON.stringify(report), revertible, revertedBy: null })
	j(70 * H, 'playbook_created', 'p-aff-package', 'Создан плейбук «Implement an aff package from a Jira ticket»')
	j(69 * H, 'review_passed', 'p-aff-package', 'p-aff-package: review → trial. Ревью пройдено', { prevStatus: 'review' }, true)
	j(68 * H, 'version', 'p-aff-package', 'p-aff-package: v1', { version: 1 })
	j(66 * H, 'playbook_created', 'p-mr-review', 'Создан плейбук «Review a merge request and report to the ticket»')
	j(65 * H, 'review_failed', 'p-mr-review', 'p-mr-review: ревью не пройдено: ступень 3 — нет критерия готовности', { prevStatus: 'review' })
	j(63 * H, 'version', 'p-mr-review', 'p-mr-review: v2 после доработки', { version: 2 }, true)
	j(60 * H, 'review_passed', 'p-mr-review', 'p-mr-review: review → trial. Ревью пройдено', { prevStatus: 'review' }, true)
	j(56 * H, 'trial_passed', 'p-aff-package', 'p-aff-package: trial → active. Пробный режим пройден: 3 кейса, поправок 0,7 на кейс против 2,5', { prevStatus: 'trial' }, true)
	j(55 * H, 'published', 'p-aff-package', 'Опубликован плагин nessy-playbooks 1.0.1: p-aff-package')
	j(50 * H, 'rule_activated', 'p-aff-package', 'p-aff-package: правило r-1 активно (4 подтверждения)', { ruleId: 'r-1', prevStatus: 'candidate' }, true)
	j(49 * H, 'rule_activated', 'p-aff-package', 'p-aff-package: правило r-2 активно (3 подтверждения)', { ruleId: 'r-2', prevStatus: 'candidate' }, true)
	j(46 * H, 'rule_archived', 'p-aff-package', 'p-aff-package: правило r-9 в архив (3 нарушения)', { ruleId: 'r-9', prevStatus: 'active' }, true)
	j(44 * H, 'version', 'p-aff-package', 'p-aff-package: v2', { version: 2 }, true)
	j(40 * H, 'edit', 'p-aff-package', 'p-aff-package: правка блоками (behavior)', { version: 2 }, true)
	j(36 * H, 'playbook_created', 'p-release-notes', 'Создан плейбук «Prepare release notes from merged MRs»')
	j(35 * H, 'review_passed', 'p-release-notes', 'p-release-notes: review → trial. Ревью пройдено', { prevStatus: 'review' })
	j(30 * H, 'trial_failed', 'p-wiki-sync', 'p-wiki-sync: trial → disabled. Пробный режим не пройден: поправок больше, чем до плейбука', { prevStatus: 'trial' })
	j(28 * H, 'rule_activated', 'p-aff-package', 'p-aff-package: правило r-4 активно (2 подтверждения)', { ruleId: 'r-4', prevStatus: 'candidate' }, true)
	j(22 * H, 'trial_passed', 'p-release-notes', 'p-release-notes: trial → active. Пробный режим пройден', { prevStatus: 'trial' }, true)
	j(20 * H, 'published', 'p-release-notes', 'Опубликован плагин nessy-playbooks 1.0.2: p-aff-package, p-release-notes')
	j(14 * H, 'edit', 'p-mr-review', 'p-mr-review: правка блоками (title, behavior)', { version: 2 }, true)
	j(10 * H, 'version', 'p-aff-package', 'p-aff-package: v3', { version: 3 }, true)
	j(9 * H, 'rule_activated', 'p-aff-package', 'p-aff-package: правило r-5 активно (2 подтверждения)', { ruleId: 'r-5', prevStatus: 'candidate' }, true)
	j(6 * H, 'review_failed', 'p-incident-triage', 'p-incident-triage: ревью не пройдено: ступень 2 — критическое замечание', { prevStatus: 'review' })
	j(5 * H, 'published', 'p-aff-package', 'Опубликован плагин nessy-playbooks 1.0.3: p-aff-package, p-release-notes')
	// откаченная запись: исходная получает revertedBy, откат идёт отдельной записью
	const reverted = J.find(e => e.id === 'j-014')
	J.push({ id: `j-${String(J.length + 1).padStart(3, '0')}`, ts: ago(38 * H), kind: 'reverted', subject: 'p-aff-package', summary: `Revert: ${reverted.summary}`, report: JSON.stringify({ reverted: reverted.id }), revertible: false, revertedBy: null })
	reverted.revertedBy = J[J.length - 1].id
	J.sort((a, b) => a.ts.localeCompare(b.ts))
	for (const e of J) pbs.appendJournal(e)

	// чаты
	let t = 0
	const chat = (subject, from, text, changes = []) => pbs.appendChat(subject, { id: `m-demo-${subject.slice(2, 8)}-${++t}`, ts: ago(Math.max(1, 9 - t) * 20 * 60_000), from, text, changes })
	chat('c-demo-aff-pkg', 'user', 'В описании у цели про MR #918 лишняя поправка про комментарии: это общее правило, а не поправка. Перенеси.')
	chat('c-demo-aff-pkg', 'agent', 'Перенёс: поправка про комментарии в GitLab осталась в разделе поправок второй цели, но теперь в плане написано «report only». Якорь n 22 сохранён.', ['summary.md'])
	chat('c-demo-aff-pkg', 'user', 'Добавь в открытые вопросы, кто обновляет потребителей aff-geo после релиза.')
	chat('c-demo-aff-pkg', 'agent', 'Добавил вопрос в «Open questions» первой цели.', ['summary.md'])
	chat('p-aff-package', 'user', 'На этапе загрузки данных всегда показывай мне данные до реализации — добавь это в этап.')
	chat('p-aff-package', 'agent', 'Этап 4 теперь с проверкой пользователя (gate), в поведение добавлена строка про показ данных. Правило r-8 осталось кандидатом.', ['SKILL.md', 'stages/04-load-data.md'])
	chat('p-aff-package', 'user', 'И убери из правил упоминание ISO-3166, оно архивное.')
	chat('p-aff-package', 'agent', 'Правило r-9 уже в архиве и в rules.md не попадает; из описания этапа ссылку на ISO убрал.', ['stages/04-load-data.md', 'rules.md'])

	// настройки, точка отсчёта, очередь
	learning.saveSettings({ enabled: true, autoReview: false, intervalMin: 1, idleMin: 60, maxAgents: 2, disabledSessions: ['demo-learn-muted'] })
	learning.saveMeta({ startedAt: NOW - 7 * D, startSeq: 0, removed: [] })
	const job = (id, kind, subject, status, o = {}) => ({
		id, kind, caseId: subject.startsWith('c-') ? subject : '', subject, status, attempts: 0, agentId: null, error: null, note: null, range: null,
		createdAt: iso(NOW - (o.created ?? 3 * H)), startedAt: o.started ? iso(NOW - o.started) : null, finishedAt: o.finished ? iso(NOW - o.finished) : null, final: false, retryAt: null, payload: null, ...o.extra,
	})
	learning.saveJobs([
		job('j-demo-1', 'close', 'c-demo-mr-3', 'done', { created: 3 * H + 5 * 60_000, started: 3 * H, finished: 3 * H - 90_000, extra: { final: true, range: [1, 8], attempts: 1 } }),
		job('j-demo-2', 'judge', 'c-demo-mr-3', 'done', { created: 3 * H - 90_000, started: 3 * H - 100_000, finished: 3 * H - 140_000, extra: { payload: { playbookId: 'p-mr-review' } } }),
		job('j-demo-3', 'collect', 'c-demo-collecting', 'done', { created: 70 * 60_000, started: 69 * 60_000, finished: 66 * 60_000, extra: { range: [1, 4] } }),
		job('j-demo-4', 'review', 'p-incident-triage', 'done', { created: 4 * H + 20 * 60_000, started: 4 * H + 15 * 60_000, finished: 4 * H, extra: { note: 'ревью не пройдено' } }),
		job('j-demo-5', 'match', 'all', 'done', { created: 2 * H, started: 2 * H - 60_000, finished: 2 * H - 4 * 60_000, extra: { payload: { caseIds: ['c-demo-mr-1', 'c-demo-mr-2', 'c-demo-mr-3'] } } }),
		// ошибок для человека нет: сбой — это повтор через паузу
		job('j-demo-6', 'close', 'c-demo-error', 'queued', { created: 6 * H, started: 5 * H + 50 * 60_000, extra: { final: true, attempts: 3, error: 'в ответе нет <summary>', range: [1, 4], retryAt: NOW + 10 * 60_000, title: 'Флейки в e2e-тестах' } }),
		job('j-demo-7', 'close', 'c-demo-closing', 'queued', { created: 2 * 60_000, extra: { final: true, retryAt: NOW + 2 * H, title: 'Update dependencies in shippy' } }),
		job('j-demo-9', 'collect', 'c-demo-collecting', 'queued', { created: 3 * 60_000, extra: { retryAt: NOW + 2 * H, title: 'Отчёт по расходам на CI' } }),
		job('j-demo-8', 'build', 'p-jira-triage', 'queued', { created: 60_000, extra: { retryAt: NOW + 2 * H, payload: { task: 'triage tickets', taskType: 'triage tickets', playbookId: 'p-jira-triage', cases: ['c-demo-dirty', 'c-demo-incident-long'] } } }),
	])
}

// ---------- фейковый nessy: сценарии сборщиков живых сессий ----------
const scenarios = {
	// сопоставитель после закрытия живого кейса: без групп (иначе задание ушло бы в ошибку)
	'# PLAYBOOK MATCHER': [{ text: '<result>\n{"groups": []}\n</result>' }],
	'CASE: c-demo-learn-a': [{ thought: 'Читаю события и составляю описание сессии.' }, { hang: 'Собираю описание сессии demo-learn-a' }],
	'CASE: c-demo-learn-b': [{ thought: 'Читаю события блоками и веду черновик.' }, { hang: 'Собираю описание сессии demo-learn-b' }],
	'Цель: составить чеклист релиза shippy 2.5': '#work 3 Найти MR после 2.4 => GitLab: MR since 2.4; Сгруппировать => Think: группы; Написать чеклист => Think: чеклист || **Итог** — чеклист релиза готов.\n\n**Источники**\n1. GitLab shippy\n\nСтатус: DONE',
	'Цель: сгруппировать MR по областям': '#work 2 Взять список MR => Read: список; Сгруппировать => Think: группы || **Итог** — 5 областей.\n\n**Источники**\n1. GitLab shippy\n\nСтатус: DONE',
	'Цель: выяснить, почему растёт очередь заданий в billing': '#work 2 Посмотреть метрики очереди => Grafana: billing queue; Найти потребителя => Grep: consumer || **Итог** — потребитель отстаёт после деплоя 14:20.\n\n**Источники**\n1. Grafana billing\n\nСтатус: DONE',
}

function writeTranscripts() {
	const dir = path.join(PROJECTS, 'demo-project')
	fs.mkdirSync(dir, { recursive: true })
	const mk = (id, mtimeAgo, lines) => {
		const file = path.join(dir, `${id}.jsonl`)
		const out = []
		let k = 0
		for (const [role, text, cmd] of lines) {
			const ts = new Date(NOW - mtimeAgo + k * 60_000).toISOString()
			k++
			if (role === 'user') out.push({ type: 'user', uuid: `${id}-u${k}`, timestamp: ts, message: { role: 'user', content: text } })
			else out.push({ type: 'assistant', uuid: `${id}-a${k}`, timestamp: ts, message: { role: 'assistant', content: [{ type: 'text', text }, ...(cmd ? [{ type: 'tool_use', id: `${id}-t${k}`, name: 'Bash', input: { command: cmd } }] : [])] } })
		}
		fs.writeFileSync(file, out.map(r => JSON.stringify(r)).join('\n') + '\n')
		fs.utimesSync(file, new Date(NOW - mtimeAgo), new Date(NOW - mtimeAgo))
	}
	mk('demo-chat-lang', 4 * D, [['user', 'Сделай пакет aff-lang по AFF-390'], ['assistant', 'Запускаю агента.', 'nessy-orch spawn --role executor --name e1 "скелет packages/aff-lang"']])
	mk('demo-chat-deploy', 2 * D + 3 * H, [['user', 'Раскатай hotfix pay-gw на staging, потом на прод после моего ок.'], ['assistant', 'Поручаю агенту.', 'nessy-orch spawn --role executor --name deployer "раскатать hotfix"'], ['user', 'На прод только после моего ок.'], ['assistant', 'Жду ок.', 'nessy-orch send deployer "ждём ок"']])
	mk('demo-chat-metrics', 18 * H, [['user', 'Почему просела конверсия в чекауте за вчера?'], ['assistant', 'Смотрю метрики.', 'nessy-orch spawn --role analyst --name conv "найти причину просадки"'], ['assistant', 'Нашёл: сломан купон.', 'nessy-orch wait conv']])
}

// ---------- сервер и живые сессии ----------
function api(method, p, body) {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? null : JSON.stringify(body)
		const req = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: { ...(TOKEN ? { 'X-Orch-Token': TOKEN } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, res => {
			let d = ''
			res.setEncoding('utf8')
			res.on('data', c => (d += c))
			res.on('end', () => {
				try {
					resolve({ status: res.statusCode ?? 0, body: d ? JSON.parse(d) : {} })
				} catch {
					resolve({ status: res.statusCode ?? 0, body: {} })
				}
			})
		})
		req.on('error', reject)
		if (payload) req.write(payload)
		req.end()
	})
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitUp(ms = 60_000) {
	const t0 = Date.now()
	for (;;) {
		try {
			if ((await api('GET', '/health')).status === 200) return
		} catch {
			/* ещё не поднялся */
		}
		if (Date.now() - t0 > ms) throw new Error('демо-сервер не поднялся')
		await sleep(300)
	}
}

const LIVE = [
	{
		session: { id: 'demo-learn-a', title: 'Очередь заданий в billing растёт', owner: 'claude-1' },
		agents: [{ name: 'queue-explorer', role: 'code-explorer', prompt: 'Цель: выяснить, почему растёт очередь заданий в billing.\nКонтекст: очередь растёт с 14:20.\nГраницы: только чтение.\nРезультат: причина и ссылка на график.' }],
	},
	{
		session: { id: 'demo-learn-b', title: 'Чеклист релиза shippy 2.5', owner: 'claude-2' },
		agents: [
			{ name: 'release-lister', role: 'code-explorer', prompt: 'Цель: составить чеклист релиза shippy 2.5.\nКонтекст: последний тег 2.4.\nГраницы: только чтение.\nРезультат: список MR и чеклист.' },
			{ name: 'release-grouper', role: 'code-explorer', prompt: 'Цель: сгруппировать MR по областям.\nКонтекст: список MR от release-lister.\nГраницы: только чтение.\nРезультат: группы.' },
		],
	},
	{ session: { id: 'demo-learn-muted', title: 'Сессия с выключенным обучением', owner: 'claude-3' }, agents: [] },
]

async function seedLive() {
	await waitUp()
	const ws = path.join(HOME, 'ws', 'shippy')
	fs.mkdirSync(ws, { recursive: true })
	await api('POST', '/spaces', { path: ws, name: 'shippy' })
	const roles = new Set(((await api('GET', '/roles')).body ?? []).map?.(r => r.id) ?? [])
	for (const t of LIVE) {
		const r = await api('POST', '/sessions', t.session)
		if (r.status !== 201 && r.status !== 409) throw new Error(`сессия ${t.session.id}: ${r.status}`)
		if (r.status === 409) continue
		for (const a of t.agents) {
			const s = await api('POST', '/agents', { space: 'shippy', session: r.body.id, name: a.name, role: roles.has(a.role) ? a.role : undefined, prompt: a.prompt })
			if (s.status !== 201) console.warn(`[demo-learning] агент ${a.name}: ${s.status} ${s.body.error ?? ''}`)
			await sleep(400)
		}
	}
	// кейсы заведёт ближайший тик (5 с); потом сборщик запускается вручную, не дожидаясь интервала
	await sleep(7000)
	for (const id of ['demo-learn-a', 'demo-learn-b']) {
		const r = await api('POST', '/learning/run', { session: id })
		console.log(`[demo-learning] сборщик ${id}: ${r.status}`)
	}
	await progressRunning()
}

// Фейковый сборщик не вызывает `case read/draft` сам — делаем это за него теми же ручками API (оператору они разрешены):
// читаем маленький блок событий (указатель чтения → прогресс) и кладём черновик с промежуточным описанием.
async function progressRunning() {
	const t0 = Date.now()
	let running = []
	while (Date.now() - t0 < 30_000) {
		const l = await api('GET', '/learning')
		running = (l.body.jobs ?? []).filter(j => j.status === 'running' && (j.kind === 'collect' || j.kind === 'close') && j.caseId)
		if (running.length >= 2) break
		await sleep(500)
	}
	for (const j of running) {
		const blk = await api('GET', `/learning/cases/${j.caseId}/read?maxChars=400`)
		const draft = [
			'<summary>',
			`# ${j.title ?? j.caseId}`,
			'',
			'## Goal 1: черновик',
			'',
			'**Plan**',
			'- Собрать события сессии и описать цели, действия агентов и поправки пользователя.',
			'',
			'**Actions**',
			'1. Прочитан первый блок событий (n ' + blk.body.from + '–' + blk.body.until + '): запрос пользователя и поручение агенту.',
			'',
			'**Corrections**',
			'- пока нет',
			'',
			'**Open questions**',
			'- Описание неполное: сборщик прочитал не все события.',
			'</summary>',
			'',
		].join('\n')
		const r = await api('POST', `/learning/cases/${j.caseId}/draft`, { text: draft })
		console.log(`[demo-learning] прогресс ${j.caseId}: read ${blk.status}, draft ${r.status}`)
	}
}

async function main() {
	if (!seeded) {
		build()
		console.log(`[demo-learning] данные записаны в ${HOME}`)
	} else {
		console.log('[demo-learning] каталог уже засеян (запуск с --fresh пересоздаёт его); поднимаю сервер на нём')
	}
	fs.writeFileSync(path.join(HOME, 'fake-scenarios.json'), JSON.stringify(scenarios, null, 2))
	writeTranscripts()
	const server = spawn(process.execPath, [path.join(DIST, 'src/main.js')], {
		stdio: 'inherit',
		env: {
			...process.env,
			NESSY_ORCH_HOME: HOME,
			ORCH_PORT: String(PORT),
			NESSY_BIN: path.join(DIST, 'test/support/fake-nessy.js'),
			ORCH_LEARNING_DEFAULT: '1',
			ORCH_LEARNING_TICK_MS: '5000',
			CLAUDE_PROJECTS_DIR: PROJECTS,
			ORCH_PLAYBOOKS_PLUGIN_DIR: PLUGIN_DIR,
			ORCH_AUTO_APPROVE: '0',
		},
	})
	const stop = () => server.kill('SIGTERM')
	process.on('SIGINT', stop)
	process.on('SIGTERM', stop)
	server.on('exit', code => process.exit(code ?? 0))
	await seedLive()
	console.log(`[demo-learning] готово: http://127.0.0.1:${PORT}, токен — из ~/.nessy-orch/token. Остановка: Ctrl+C`)
}

main().catch(e => {
	console.error(`[demo-learning] ошибка: ${e instanceof Error ? e.stack : String(e)}`)
	process.exit(1)
})
