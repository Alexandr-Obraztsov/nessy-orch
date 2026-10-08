/**
 * Каркас: загрузка, раскладка без переполнения, вкладки, горячие клавиши, выезжающая панель.
 */
import { expect, expectNoOverflow, openApp, openSpawnDialog, openWithTabs, row, section, shot, sidebar, tab, test, uid } from './fixtures'

test.describe('загрузка и раскладка', () => {
	test('приложение грузится, «в сети», вкладка «Лента», без ошибок консоли', async ({ page, narrow }, info) => {
		await openApp(page)
		if (narrow) await expect(page.getByRole('banner')).toContainText('Лента')
		else {
			await expect(tab(page, 'Лента')).toHaveAttribute('aria-selected', 'true')
			await expect(page.getByRole('toolbar', { name: 'Быстрые действия' })).toBeVisible()
			await expect(page.getByRole('navigation', { name: 'Навигация' })).toBeVisible()
		}
		await expectNoOverflow(page, 'главный экран')
		await shot(page, info, 'main')
	})

	test('нет переполнения: диалоги агента и пространства', async ({ page, narrow }, info) => {
		await openApp(page)
		const dlg = await openSpawnDialog(page, narrow)
		await expectNoOverflow(page, 'диалог агента')
		await shot(page, info, 'dialog-spawn')
		await dlg.getByRole('button', { name: 'Отмена' }).click()
		await expect(dlg).toBeHidden()

		if (narrow) {
			const sec = await section(page, narrow, 'Пространства')
			await sec.getByRole('button', { name: 'Добавить пространство' }).click()
		} else {
			await page.getByRole('toolbar', { name: 'Быстрые действия' }).getByRole('button', { name: 'Добавить пространство' }).click()
		}
		await expect(page.getByRole('dialog', { name: 'Новое пространство' })).toBeVisible()
		await expectNoOverflow(page, 'диалог пространства')
		await shot(page, info, 'dialog-space')
	})

	test('длинные имена не ломают раскладку (панель, вкладки, граф)', async ({ page, ws, narrow }, info) => {
		const long = `very-long-agent-name-${uid()}-${'x'.repeat(40)}`
		const a = await ws.spawn(long)
		await openWithTabs(page, [{ kind: 'feed' }, { kind: 'graph' }, { kind: 'agent', id: a.id }], 1)
		await expect(page.locator(`[data-node="${a.id}"]`)).toBeAttached()
		await expectNoOverflow(page, 'граф с длинным именем')
		const nav = await sidebar(page, narrow)
		await expect(row(nav, long)).toBeVisible()
		await expectNoOverflow(page, 'панель с длинным именем')
		await shot(page, info, 'long-names')
	})
})

test.describe('вкладки', () => {
	test('открытие, переключение, закрытие крестиком и средней кнопкой', async ({ page, ws, narrow }, info) => {
		test.skip(narrow, 'полоса вкладок только на широких экранах')
		const a = await ws.spawn(`tb-${uid()}`)
		await openApp(page)
		const nav = await sidebar(page, narrow)
		await row(await section(page, narrow, 'Агенты'), a.name).click()
		await expect(tab(page, a.name)).toHaveAttribute('aria-selected', 'true')
		await expect(row(nav, a.name)).toHaveAttribute('aria-current', 'page')

		await page.getByRole('toolbar', { name: 'Быстрые действия' }).getByRole('button', { name: /Граф/ }).click()
		await expect(tab(page, 'Граф')).toHaveAttribute('aria-selected', 'true')
		await shot(page, info, 'tabs')

		// повторное открытие не плодит дубликатов
		await row(nav, a.name).click()
		await expect(page.getByRole('tab', { name: a.name })).toHaveCount(1)

		// средняя кнопка закрывает вкладку
		await tab(page, 'Граф').click({ button: 'middle' })
		await expect(tab(page, 'Граф')).toHaveCount(0)
		// крестик
		await page.getByRole('button', { name: `Закрыть вкладку ${a.name}` }).click()
		await expect(tab(page, a.name)).toHaveCount(0)
		// «Лента» не закрывается
		await expect(page.getByRole('button', { name: 'Закрыть вкладку Лента' })).toHaveCount(0)
		await expect(tab(page, 'Лента')).toHaveAttribute('aria-selected', 'true')
	})

	test('вкладки сохраняются после перезагрузки; много вкладок — без переполнения', async ({ page, ws, narrow }, info) => {
		test.skip(narrow, 'полоса вкладок только на широких экранах')
		const agents = await Promise.all(Array.from({ length: 8 }, (_, i) => ws.spawn(`mt${i}-${uid()}`)))
		await openWithTabs(page, [{ kind: 'feed' }, { kind: 'graph' }, ...agents.map(a => ({ kind: 'agent', id: a.id }))])
		const last = agents[agents.length - 1]
		if (!last) return
		await expect(tab(page, last.name)).toHaveAttribute('aria-selected', 'true')
		await expect(tab(page, last.name)).toBeInViewport()
		await expectNoOverflow(page, 'много вкладок')
		await shot(page, info, 'many-tabs')
		await page.reload()
		await expect(tab(page, last.name)).toHaveAttribute('aria-selected', 'true')
		await expect(page.getByRole('tab')).toHaveCount(10)
	})
})

test.describe('горячие клавиши', () => {
	test('N, G, F, R, Ctrl+W, Esc', async ({ page, narrow }) => {
		test.skip(narrow, 'клавиатура — на широких экранах')
		await openApp(page)
		await page.locator('body').click({ position: { x: 600, y: 4 } })
		await page.keyboard.press('n')
		const dlg = page.getByRole('dialog', { name: 'Новый агент' })
		await expect(dlg).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(dlg).toBeHidden()

		await page.keyboard.press('g')
		await expect(tab(page, 'Граф')).toHaveAttribute('aria-selected', 'true')
		await page.keyboard.press('f')
		await expect(tab(page, 'Лента')).toHaveAttribute('aria-selected', 'true')
		await page.keyboard.press('r')
		await expect(tab(page, 'Новая роль')).toHaveAttribute('aria-selected', 'true')
		// в поле ввода буквы не перехватываются
		await page.getByLabel('Название роли').fill('gfn')
		await expect(page.getByLabel('Название роли')).toHaveValue('gfn')
		await page.keyboard.press('Control+w')
		await expect(tab(page, 'gfn')).toHaveCount(0)
		await expect(tab(page, 'Новая роль')).toHaveCount(0)
	})
})

test.describe('узкие экраны', () => {
	test('левая панель выезжает: «Лента» / «Граф», scrim и Esc закрывают', async ({ page, narrow }, info) => {
		test.skip(!narrow, 'только узкие экраны')
		await openApp(page)
		const nav = page.getByRole('navigation', { name: 'Навигация' })
		await expect(nav).toBeHidden()
		await page.getByRole('button', { name: 'Открыть панель' }).click()
		await expect(nav).toBeVisible()
		await expectNoOverflow(page, 'выезжающая панель')
		await shot(page, info, 'drawer')

		await row(nav, 'Граф').click()
		await expect(nav).toBeHidden()
		await expect(page.getByRole('banner')).toContainText('Граф')
		await expect(page.locator('[data-node="you"]')).toBeAttached()

		await page.getByRole('button', { name: 'Открыть панель' }).click()
		await page.keyboard.press('Escape')
		await expect(nav).toBeHidden()

		await page.getByRole('button', { name: 'Открыть панель' }).click()
		await page.mouse.click((page.viewportSize()?.width ?? 390) - 10, 400)
		await expect(nav).toBeHidden()

		// закрыть вкладку «Граф» из верхней панели
		await page.getByRole('banner').getByRole('button', { name: 'Закрыть вкладку' }).click()
		await expect(page.getByRole('banner')).toContainText('Лента')
	})
})
