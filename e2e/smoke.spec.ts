/**
 * Дымовые e2e-проверки UI v4 («Таблица»): таблица загрузилась, строка агента видна, панель деталей
 * открывается, «Разрешить» снимает запрос, раскладка не вылезает за экран (десктоп и телефон).
 * Данные создаются через HTTP API, фейковый nessy отвечает по меткам (#plan — план, #perm — разрешение).
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

async function open(page: Page): Promise<string[]> {
	const errors: string[] = []
	page.on('pageerror', e => errors.push(e.message))
	page.on('console', m => m.type() === 'error' && errors.push(m.text()))
	await page.goto('/')
	await expect(page.locator('[data-conn="live"]')).toBeVisible()
	await expect(page.getByRole('table', { name: 'Агенты' })).toBeVisible()
	return errors
}

async function noOverflow(page: Page): Promise<void> {
	const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
	expect(over).toBeLessThanOrEqual(0)
}

const row = (page: Page, name: string) => page.getByRole('row', { name: new RegExp(`^${name},`) })

test('таблица загружается без ошибок и без горизонтальной прокрутки', async ({ page }) => {
	const errors = await open(page)
	await expect(page.getByRole('navigation', { name: 'Фильтры' })).toBeVisible()
	await noOverflow(page)
	expect(errors).toEqual([])
})

test('агент с планом: строка в «Выполнено», панель показывает план и итоговый ответ', async ({ page, request }) => {
	const name = await spawn(request, 'Проверить README\n#plan')
	await open(page)
	const r = row(page, name)
	await expect(r).toBeVisible()
	await expect(page.getByRole('rowgroup', { name: 'Выполнено' }).getByRole('row', { name: new RegExp(`^${name},`) })).toBeVisible()
	await r.click()
	const detail = page.locator(`[data-agent-detail]`)
	await expect(detail.getByRole('region', { name: 'План' })).toContainText('3 из 3')
	await expect(detail.getByRole('region', { name: 'Итоговый ответ' })).toContainText('План выполнен')
	await noOverflow(page)
	await page.keyboard.press('Escape')
	await expect(page.locator('[data-panel]')).toHaveCount(0)
})

test('запрос разрешения: «Разрешить» в строке снимает запрос', async ({ page, request }) => {
	const name = await spawn(request, 'Выполнить команду\n#perm ls')
	await open(page)
	const r = row(page, name)
	await expect(r).toHaveAttribute('data-state', 'wait')
	await expect(page).toHaveTitle(/^\(\d+\) nessy-orch/)
	await noOverflow(page)
	await r.getByRole('button', { name: 'Разрешить' }).click()
	// запрос снят; агент доделывает ход и переезжает в «Выполнено»
	await expect(r.getByRole('button', { name: 'Разрешить' })).toHaveCount(0)
	await expect(r).toHaveAttribute('data-state', 'done')
	await noOverflow(page)
})
