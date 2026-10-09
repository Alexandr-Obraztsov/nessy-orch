/**
 * Дымовые e2e-проверки UI v5 («как Claude»): сайдбар задач, карточки агентов, окно агента с планом и чатом,
 * «Разрешить» на карточке, параллельный просмотр двух задач, раскладка без горизонтальной прокрутки
 * (десктоп и телефон). Данные создаются через HTTP API, фейковый nessy отвечает по меткам
 * (#plan — план, #perm — разрешение).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const uid = (): string => Math.random().toString(36).slice(2, 7)

/** Задача оркестратора; возвращает её id. */
async function task(request: APIRequestContext, title: string): Promise<string> {
	const r = await request.post('/tasks', { data: { title, owner: 'e2e' } })
	expect(r.ok()).toBeTruthy()
	return ((await r.json()) as { id: string }).id
}

/** Пространство во временном каталоге + агент с задачей в нём; возвращает имя агента. */
async function spawn(request: APIRequestContext, taskId: string, prompt: string): Promise<string> {
	const name = `e2e-${uid()}`
	const dir = mkdtempSync(path.join(tmpdir(), 'nessy-e2e-ws-'))
	const sp = await request.post('/spaces', { data: { path: dir, name: `ws-${uid()}` } })
	expect(sp.ok()).toBeTruthy()
	const space = ((await sp.json()) as { name: string }).name
	const r = await request.post('/agents', { data: { space, name, prompt, task: taskId } })
	expect(r.ok()).toBeTruthy()
	return name
}

async function open(page: Page, url = '/'): Promise<string[]> {
	const errors: string[] = []
	page.on('pageerror', e => errors.push(e.message))
	page.on('console', m => m.type() === 'error' && errors.push(m.text()))
	await page.goto(url)
	await expect(page.locator('[data-conn="live"]')).toBeVisible()
	return errors
}

async function noOverflow(page: Page): Promise<void> {
	const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
	expect(over).toBeLessThanOrEqual(0)
}

const card = (page: Page, name: string) => page.getByRole('article', { name: new RegExp(`^${name},`) })

test('панель загружается без ошибок и без горизонтальной прокрутки', async ({ page }) => {
	const errors = await open(page)
	await expect(page.getByRole('heading', { level: 1, name: 'Все агенты' })).toBeVisible()
	await noOverflow(page)
	expect(errors).toEqual([])
})

test('агент с планом: карточка в «Выполнено», окно показывает план и ответ', async ({ page, request }) => {
	const id = await task(request, `План ${uid()}`)
	const name = await spawn(request, id, 'Проверить README\n#plan')
	await open(page, `/?task=${id}`)
	const group = page.getByRole('button', { name: /Выполнено/ })
	await expect(group).toBeVisible()
	if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
	const c = card(page, name)
	await expect(c).toHaveAttribute('data-state', 'done')
	await c.getByRole('button', { name }).click()
	await expect(page).toHaveURL(/agent=/)
	const win = page.locator('[data-agent-window]')
	await expect(win.getByRole('complementary', { name: 'План' })).toContainText('3 из 3')
	await expect(win.getByRole('log')).toContainText('План выполнен')
	await noOverflow(page)
	await page.keyboard.press('Escape')
	await expect(page.locator('[data-agent-window]')).toHaveCount(0)
	await expect(page).not.toHaveURL(/agent=/)
})

test('запрос разрешения: «Разрешить» на карточке снимает запрос', async ({ page, request }) => {
	const id = await task(request, `Разрешение ${uid()}`)
	const name = await spawn(request, id, 'Выполнить команду\n#perm ls')
	await open(page, `/?task=${id}`)
	const c = card(page, name)
	await expect(c).toHaveAttribute('data-state', 'wait')
	await expect(page).toHaveTitle(/^\(\d+\) nessy-orch/)
	await noOverflow(page)
	await c.getByRole('button', { name: 'Разрешить' }).click()
	// запрос снят; агент доделывает ход и уходит в «Выполнено»
	await expect(page.locator(`[data-card] >> text=Просит разрешение`)).toHaveCount(0)
	await expect(c).toHaveAttribute('data-state', 'done')
	await noOverflow(page)
})

test('две задачи рядом: обе колонки в одном экране', async ({ page, request }) => {
	const a = await task(request, `Слева ${uid()}`)
	const b = await task(request, `Справа ${uid()}`)
	await open(page, `/?task=${a},${b}`)
	await expect(page.locator(`[data-column="${a}"]`)).toBeVisible()
	await expect(page.locator(`[data-column="${b}"]`)).toBeVisible()
	await noOverflow(page)
	await page.locator(`[data-column="${b}"]`).getByRole('button', { name: 'Закрыть колонку' }).click()
	await expect(page.locator('[data-column]')).toHaveCount(1)
	await expect(page).toHaveURL(new RegExp(`task=${a}$`))
})
