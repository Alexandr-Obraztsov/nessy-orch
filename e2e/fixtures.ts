/**
 * Общие фикстуры e2e: чистое пространство на тест, быстрый спавн агентов через HTTP API,
 * сторож консольных ошибок, проверка горизонтального переполнения, скриншоты.
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test as base, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test'

export interface Agent {
	id: string
	name: string
	space: string
}

export interface Role {
	id: string
	name: string
}

export interface Workspace {
	name: string
	dir: string
	/** агент без задачи остаётся активным; с задачей — после ответа уходит в архив */
	spawn: (name: string, prompt?: string, extra?: { role?: string; parent?: string }) => Promise<Agent>
}

let counter = 0
/** Уникальный суффикс: имена не пересекаются между тестами и проектами. */
export const uid = (): string => `${Date.now().toString(36).slice(-4)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 4)}`

async function createWorkspace(request: APIRequestContext): Promise<Workspace> {
	const dir = await mkdtemp(path.join(tmpdir(), 'nessy-e2e-ws-'))
	const name = `ws-${uid()}`
	const res = await request.post('/spaces', { data: { path: dir, name } })
	expect(res.status(), await res.text()).toBe(201)
	return {
		name,
		dir,
		spawn: async (agentName, prompt, extra) => {
			const r = await request.post('/agents', { data: { space: name, name: agentName, prompt, ...extra } })
			expect(r.status(), await r.text()).toBe(201)
			const body = (await r.json()) as { agent: { id: string } } | { id: string }
			const id = 'agent' in body ? body.agent.id : body.id
			return { id, name: agentName, space: name }
		},
	}
}

/** Создать роль через API. */
export async function createRole(request: APIRequestContext, name: string, instructions = 'Будь краток.', description = ''): Promise<Role> {
	const r = await request.post('/roles', { data: { name, instructions, description } })
	expect(r.status(), await r.text()).toBe(201)
	const body = (await r.json()) as Role
	return { id: body.id, name: body.name }
}

export interface Fixtures {
	ws: Workspace
	/** ширина < 900 — одна колонка с нижними вкладками */
	narrow: boolean
	/** ошибки консоли и страницы; тест падает, если они есть */
	guard: string[]
}

export const test = base.extend<Fixtures>({
	ws: async ({ request }, use) => {
		await use(await createWorkspace(request))
	},
	narrow: async ({ viewport }, use) => {
		await use((viewport?.width ?? 1440) < 900)
	},
	guard: [
		async ({ page }, use) => {
			const errors: string[] = []
			page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
			page.on('console', m => {
				if (m.type() === 'error') errors.push(`console: ${m.text()}`)
			})
			await use(errors)
			expect(errors, 'ошибки в консоли/странице').toEqual([])
		},
		{ auto: true },
	],
})

export { expect }

/** Открыть приложение и дождаться подключения к потоку. */
export async function openApp(page: Page): Promise<void> {
	await page.goto('/')
	await expect(page.getByRole('status').filter({ hasText: 'в сети' })).toBeAttached()
}

/** Открыть приложение сразу с заданными вкладками (вкладки хранятся в localStorage). */
export async function openWithTabs(page: Page, tabs: object[], active = tabs.length - 1): Promise<void> {
	await page.goto('/')
	await page.evaluate(
		([t, a]) => localStorage.setItem('nessy-orch:view', JSON.stringify({ tabs: t, active: a, feed: { agentChatter: false, system: false } })),
		[tabs, active] as const,
	)
	await page.reload()
	await expect(page.getByRole('status').filter({ hasText: 'в сети' })).toBeAttached()
}

/** Проверка: страница не прокручивается по горизонтали. */
export async function expectNoOverflow(page: Page, what: string): Promise<void> {
	const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth }))
	expect(m.sw, `горизонтальное переполнение (${what}): scrollWidth ${m.sw} > innerWidth ${m.iw}`).toBeLessThanOrEqual(m.iw)
	expect(m.bw, `переполнение body (${what})`).toBeLessThanOrEqual(m.iw)
}

/** Скриншот состояния в отчёт и в test-results/shots. */
export async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
	const file = path.join(process.env['PW_OUT'] || '.', 'test-results', 'shots', info.project.name, `${name}.png`)
	const body = await page.screenshot({ animations: 'disabled', path: file })
	await info.attach(`${info.project.name}-${name}`, { body, contentType: 'image/png' })
}

/** Левая панель (дерево). На узких экранах сначала выдвигается кнопкой ☰. */
export async function sidebar(page: Page, narrow: boolean): Promise<Locator> {
	const nav = page.getByRole('navigation', { name: 'Навигация' })
	if (narrow && !(await nav.isVisible())) await page.getByRole('button', { name: 'Открыть панель' }).click()
	await expect(nav).toBeVisible()
	return nav
}

/** Секция левой панели («Агенты», «Архив», «Роли», «Пространства»), раскрытая. */
export async function section(page: Page, narrow: boolean, title: string): Promise<Locator> {
	const nav = await sidebar(page, narrow)
	const sec = nav.getByRole('region', { name: title })
	const toggle = sec.getByRole('button', { name: new RegExp(`^${title}`) }).first()
	if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
	return sec
}

/** Строка в дереве (главная кнопка строки) по точному имени. */
export const row = (scope: Locator, name: string): Locator => scope.getByRole('button', { name, exact: true })

/** Вкладка в полосе вкладок (широкие экраны). */
export const tab = (page: Page, name: string | RegExp): Locator => page.getByRole('tablist', { name: 'Вкладки' }).getByRole('tab', { name })

/** Кнопка «новый агент»: на узких — «+» в верхней панели, на широких — клавиша N. */
export async function openSpawnDialog(page: Page, narrow: boolean): Promise<Locator> {
	if (narrow) await page.getByRole('banner').getByRole('button', { name: 'Новый агент' }).click()
	else {
		await page.locator('body').click({ position: { x: 600, y: 4 } })
		await page.keyboard.press('n')
	}
	const dlg = page.getByRole('dialog', { name: 'Новый агент' })
	await expect(dlg).toBeVisible()
	return dlg
}

/** Открыть вкладку агента из левой панели (активные или архив). */
export async function openAgent(page: Page, agent: Agent, narrow: boolean, archived = false): Promise<Locator> {
	const sec = await section(page, narrow, archived ? 'Архив' : 'Агенты')
	await row(sec, agent.name).click()
	const c = chat(page)
	await expect(c).toBeVisible()
	return c
}

/** Область чата агента. */
export const chat = (page: Page): Locator => page.getByRole('region', { name: 'Чат агента' })
