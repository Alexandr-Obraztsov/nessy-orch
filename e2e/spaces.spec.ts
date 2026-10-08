import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, expectNoOverflow, openApp, shot, test, uid } from './fixtures'

test.describe('пространства и тема', () => {
	test('диалог пространства: ошибка для относительного пути и успешное добавление', async ({ page, narrow }, info) => {
		await openApp(page)
		if (narrow) {
			await page.getByRole('button', { name: 'Меню' }).click()
			await page.getByRole('button', { name: 'Добавить пространство' }).click()
		} else {
			await page.getByRole('banner').getByTitle(/Добавить пространство/).click()
		}
		const dlg = page.getByRole('dialog', { name: 'Новое пространство' })
		await expect(dlg).toBeVisible()

		await dlg.getByLabel('Путь к папке').fill('relative/dir')
		await dlg.getByRole('button', { name: 'Добавить' }).click()
		await expect(dlg.getByRole('alert').or(dlg.getByText(/абсолютн/i)).first()).toBeVisible()
		await expectNoOverflow(page, 'ошибка в диалоге пространства')
		await shot(page, info, 'space-error')

		const dir = await mkdtemp(path.join(tmpdir(), 'nessy-e2e-add-'))
		const name = `add-${uid()}`
		await dlg.getByLabel('Путь к папке').fill(dir)
		await dlg.getByLabel('Имя').fill(name)
		await dlg.getByRole('button', { name: 'Добавить' }).click()
		await expect(dlg).toBeHidden()

		// пространство видно в списке: на широких — в полосе, на узких — в меню
		if (narrow) {
			await page.getByRole('button', { name: 'Меню' }).click()
			await expect(page.getByRole('dialog', { name: 'Меню' }).getByText(name)).toBeVisible()
			await shot(page, info, 'space-added-menu')
		} else {
			await expect(page.getByRole('banner').getByText(name)).toBeVisible()
			await shot(page, info, 'space-added')
		}
	})

	test('тема переключается и сохраняется после перезагрузки', async ({ page, narrow }, info) => {
		await openApp(page)
		const html = page.locator('html')
		const before = await page.evaluate(() => (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
		const after = before === 'dark' ? 'light' : 'dark'
		const label = before === 'dark' ? 'Светлая тема' : 'Тёмная тема'
		if (narrow) {
			await page.getByRole('button', { name: 'Меню' }).click()
			await page.getByRole('button', { name: label }).click()
		} else {
			await page.getByRole('button', { name: label }).click()
		}
		await expect(html).toHaveAttribute('data-theme', after)
		await page.reload()
		await expect(page.getByRole('status').filter({ hasText: 'в сети' })).toBeAttached()
		await expect(html).toHaveAttribute('data-theme', after)
		await shot(page, info, `theme-${after}`)
		// вернуть как было — localStorage изолирован по контексту, но пусть тест не зависит от порядка
		await page.evaluate(() => localStorage.removeItem('nessy-orch:theme'))
	})
})

test.describe('мобильная навигация', () => {
	test('нижние вкладки Граф / Агенты / Лента / Чат', async ({ page, ws, narrow }, info) => {
		test.skip(!narrow, 'только узкие экраны')
		const a = await ws.spawn(`nv-${uid()}`, 'нав')
		await openApp(page)
		const bar = page.getByRole('navigation', { name: 'Разделы' })
		await expect(bar.getByRole('button', { name: 'Чат' })).toBeDisabled()

		await bar.getByRole('button', { name: 'Агенты' }).click()
		await expect(page.getByRole('complementary', { name: 'Агенты' })).toBeVisible()
		await bar.getByRole('button', { name: 'Лента' }).click()
		await expect(page.getByRole('region', { name: 'Общая лента' })).toBeVisible()
		await bar.getByRole('button', { name: 'Граф' }).click()
		await expect(page.getByRole('region', { name: 'Граф агентов' })).toBeVisible()

		// тап по узлу открывает чат
		await page.locator(`[data-node="${a.id}"]`).focus()
		await page.keyboard.press('Enter')
		await expect(page.getByRole('region', { name: 'Чат агента' })).toBeVisible()
		await expect(bar.getByRole('button', { name: new RegExp(a.name) })).toHaveAttribute('aria-current', 'page')
		await shot(page, info, 'tab-chat')
		await page.getByRole('button', { name: 'К списку агентов' }).click()
		await expect(page.getByRole('complementary', { name: 'Агенты' })).toBeVisible()
	})
})
