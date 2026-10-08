/**
 * Дымовые e2e-проверки UI: приложение живо, поручение видно с планом, разрешение нажимается,
 * раскладка не вылезает за экран. Данные создаются через HTTP API, фейковый nessy отвечает по меткам
 * (#plan — план с прогрессом, #perm — запрос разрешения).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const uid = (): string => Math.random().toString(36).slice(2, 7)

/** Пространство во временном каталоге + агент с задачей; возвращает имя агента. */
async function spawn(request: APIRequestContext, prompt: string): Promise<string> {
	const name = `e2e-${uid()}`
	const dir = mkdtempSync(path.join(tmpdir(), 'nessy-e2e-ws-'))
	const sp = await request.post('/spaces', { data: { path: dir, name: `ws-${uid()}` } })
	expect(sp.ok()).toBeTruthy()
	const space = ((await sp.json()) as { name: string }).name
	const r = await request.post('/agents', { data: { space, name, prompt } })
	expect(r.ok()).toBeTruthy()
	return name
}

async function open(page: Page): Promise<void> {
	const errors: string[] = []
	page.on('pageerror', e => errors.push(e.message))
	page.on('console', m => m.type() === 'error' && errors.push(m.text()))
	await page.goto('/')
	await expect(page.locator('[data-conn="live"]')).toBeVisible()
	expect(errors).toEqual([])
}

async function noOverflow(page: Page): Promise<void> {
	const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
	expect(over).toBeLessThanOrEqual(0)
}

const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 900

test('приложение открывается, связь есть, без горизонтальной прокрутки', async ({ page }) => {
	await open(page)
	await noOverflow(page)
})

test('поручение с планом: видно в списке, детали показывают выполненный план', async ({ page, request }) => {
	const name = await spawn(request, '#plan')
	await open(page)
	const row = page.getByText(name, { exact: true }).first()
	await expect(row).toBeVisible()
	await row.click()
	const plan = page.getByRole('region', { name: 'План' })
	await expect(plan).toBeVisible()
	await expect(plan).toContainText('3 из 3')
	await noOverflow(page)
})

test('запрос разрешения: «Разрешить» снимает запрос', async ({ page, request }) => {
	const name = await spawn(request, '#perm ls')
	await open(page)
	if (isMobile(page)) await page.getByRole('tablist', { name: 'Разделы' }).getByText('Внимание').click()
	const card = page.getByRole('group', { name: `${name}: запрос разрешения` })
	await expect(card).toBeVisible()
	await card.getByRole('button', { name: 'Разрешить', exact: true }).click()
	// запрос снят; агент доделывает ход, и его ответ появляется в «Результатах»
	await expect(card).toHaveCount(0)
	await expect(page.getByRole('group', { name: `${name}: результат` })).toBeVisible()
	await noOverflow(page)
})
