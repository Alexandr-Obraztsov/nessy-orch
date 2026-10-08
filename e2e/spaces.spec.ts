/**
 * Пространства и тема: диалог добавления с ошибками, меню пространства, удаление, тема.
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, expectNoOverflow, openApp, row, section, shot, sidebar, test, uid } from './fixtures'

test.describe('пространства', () => {
	test('диалог: ошибка для относительного пути, затем успешное добавление', async ({ page, narrow }, info) => {
		await openApp(page)
		const spaces = await section(page, narrow, 'Пространства')
		await spaces.getByRole('button', { name: 'Добавить пространство' }).click()
		const dlg = page.getByRole('dialog', { name: 'Новое пространство' })
		await expect(dlg).toBeVisible()

		await dlg.getByLabel('Путь к папке').fill('relative/dir')
		await dlg.getByRole('button', { name: 'Добавить' }).click()
		await expect(dlg.getByText(/абсолютн/i).first()).toBeVisible()
		await expectNoOverflow(page, 'ошибка в диалоге пространства')
		await shot(page, info, 'space-error')

		const dir = await mkdtemp(path.join(tmpdir(), 'nessy-e2e-add-'))
		const name = `add-${uid()}`
		await dlg.getByLabel('Путь к папке').fill(dir)
		await dlg.getByLabel('Имя').fill(name)
		await dlg.getByRole('button', { name: 'Добавить' }).click()
		await expect(dlg).toBeHidden()
		await expect(row(await section(page, narrow, 'Пространства'), name)).toBeVisible()
		await shot(page, info, 'space-added')
	})

	test('меню пространства: «Новый агент здесь» и удаление', async ({ page, ws, narrow }, info) => {
		await openApp(page)
		const spaces = await section(page, narrow, 'Пространства')
		await row(spaces, ws.name).click()
		const menu = page.getByRole('menu', { name: `Пространство ${ws.name}` })
		await expect(menu).toBeVisible()
		await shot(page, info, 'space-menu')
		await menu.getByRole('menuitem', { name: 'Новый агент здесь' }).click()
		const dlg = page.getByRole('dialog', { name: 'Новый агент' })
		await expect(dlg.getByLabel('Пространство')).toHaveValue(ws.name)
		await dlg.getByRole('button', { name: 'Отмена' }).click()

		const again = await section(page, narrow, 'Пространства')
		await row(again, ws.name).click({ button: 'right' })
		await page.getByRole('menuitem', { name: 'Удалить…' }).click()
		const confirm = page.getByRole('dialog', { name: `Удалить пространство «${ws.name}»?` })
		await confirm.getByRole('button', { name: 'Удалить' }).click()
		await expect(confirm).toBeHidden()
		await expect(row(await sidebar(page, narrow), ws.name)).toHaveCount(0)
	})

	test('пространство с агентами удаляется только вместе с ними', async ({ page, ws, narrow }) => {
		const a = await ws.spawn(`sp-${uid()}`)
		await openApp(page)
		const spaces = await section(page, narrow, 'Пространства')
		await row(spaces, ws.name).click({ button: 'right' })
		await page.getByRole('menuitem', { name: 'Удалить…' }).click()
		const confirm = page.getByRole('dialog', { name: `Удалить пространство «${ws.name}»?` })
		await expect(confirm.getByText(/есть агенты/)).toBeVisible()
		await confirm.getByRole('button', { name: 'Удалить вместе с агентами' }).click()
		await expect(confirm).toBeHidden()
		await expect(row(await sidebar(page, narrow), a.name)).toHaveCount(0)
	})
})

test.describe('тема', () => {
	test('переключается и сохраняется после перезагрузки', async ({ page, narrow }, info) => {
		await openApp(page)
		const html = page.locator('html')
		const before = await page.evaluate(() => (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
		const after = before === 'dark' ? 'light' : 'dark'
		const label = before === 'dark' ? 'Светлая тема' : 'Тёмная тема'
		if (narrow) await (await sidebar(page, narrow)).getByRole('button', { name: label }).click()
		else await page.getByRole('toolbar', { name: 'Быстрые действия' }).getByRole('button', { name: label }).click()
		await expect(html).toHaveAttribute('data-theme', after)
		await page.reload()
		await expect(page.getByRole('status').filter({ hasText: 'в сети' })).toBeAttached()
		await expect(html).toHaveAttribute('data-theme', after)
		await shot(page, info, `theme-${after}`)
		await page.evaluate(() => localStorage.removeItem('nessy-orch:theme'))
	})
})
