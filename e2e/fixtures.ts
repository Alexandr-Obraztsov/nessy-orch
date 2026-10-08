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

export interface Workspace {
	name: string
	dir: string
	spawn: (name: string, prompt?: string) => Promise<Agent>
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
		spawn: async (agentName, prompt) => {
			const r = await request.post('/agents', { data: { space: name, name: agentName, prompt } })
			expect(r.status(), await r.text()).toBe(201)
			const body = (await r.json()) as { agent: { id: string } } | { id: string }
			const id = 'agent' in body ? body.agent.id : body.id
			return { id, name: agentName, space: name }
		},
	}
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

/** Проверка: страница не прокручивается по горизонтали. */
export async function expectNoOverflow(page: Page, what: string): Promise<void> {
	const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth }))
	expect(m.sw, `горизонтальное переполнение (${what}): scrollWidth ${m.sw} > innerWidth ${m.iw}`).toBeLessThanOrEqual(m.iw)
	expect(m.bw, `переполнение body (${what})`).toBeLessThanOrEqual(m.iw)
}

/** Скриншот состояния в отчёт и в test-results. */
export async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
	const body = await page.screenshot({ animations: 'disabled' })
	await info.attach(`${info.project.name}-${name}`, { body, contentType: 'image/png' })
}

/** Нижняя вкладка (только узкие экраны). */
export const tab = (page: Page, label: string): Locator => page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: label })

/** Кнопка «новый агент»: на узких — «+» в шапке, на широких — «Агент (N)». */
export async function openSpawnDialog(page: Page, narrow: boolean): Promise<Locator> {
	if (narrow) await page.getByRole('banner').getByRole('button', { name: 'Новый агент' }).click()
	else {
		await page.locator('body').click({ position: { x: 5, y: 5 } })
		await page.keyboard.press('n')
	}
	const dlg = page.getByRole('dialog', { name: 'Новый агент' })
	await expect(dlg).toBeVisible()
	return dlg
}

/** Открыть чат агента из ростера (на узких — через вкладку «Агенты», на средних — выдвижной ростер). */
export async function openChat(page: Page, agent: Agent, narrow: boolean): Promise<void> {
	const row = page.getByRole('complementary', { name: 'Агенты' }).getByRole('button').filter({ hasText: agent.name })
	if (narrow) await tab(page, 'Агенты').click()
	else if (!(await row.isVisible())) await page.getByRole('button', { name: 'Показать список агентов' }).click()
	await row.click()
	await expect(page.getByRole('region', { name: 'Чат агента' })).toBeVisible()
}

/** Пузырь/текст в области чата. */
export const chat = (page: Page): Locator => page.getByRole('region', { name: 'Чат агента' })
