import { expect, expectNoOverflow, openApp, openChat, openSpawnDialog, shot, tab, test, uid } from './fixtures'

test.describe('загрузка и раскладка', () => {
	test('приложение грузится, связь «в сети», без ошибок консоли', async ({ page }, info) => {
		await openApp(page)
		await expect(page.getByRole('status').filter({ hasText: 'в сети' })).toBeAttached()
		await expect(page.getByRole('region', { name: 'Граф агентов' })).toBeVisible()
		await expectNoOverflow(page, 'главный экран')
		await shot(page, info, 'main')
	})

	test('нет горизонтального переполнения: главные экраны и вкладки', async ({ page, ws, narrow }, info) => {
		await ws.spawn(`ov-${uid()}`, 'привет')
		await openApp(page)
		await expectNoOverflow(page, 'граф/главный')
		if (narrow) {
			for (const t of ['Агенты', 'Лента', 'Граф']) {
				await tab(page, t).click()
				await expectNoOverflow(page, `вкладка ${t}`)
				await shot(page, info, `tab-${t}`)
			}
		}
	})

	test('нет переполнения с открытыми диалогами', async ({ page, narrow }, info) => {
		await openApp(page)
		const dlg = await openSpawnDialog(page, narrow)
		await expectNoOverflow(page, 'диалог агента')
		await shot(page, info, 'dialog-spawn')
		await dlg.getByRole('button', { name: 'Отмена' }).click()
		await expect(dlg).toBeHidden()

		if (narrow) {
			await page.getByRole('button', { name: 'Меню' }).click()
			await expectNoOverflow(page, 'меню')
			await shot(page, info, 'menu')
			await page.getByRole('button', { name: 'Добавить пространство' }).click()
		} else {
			await page.getByRole('banner').getByTitle(/Добавить пространство/).click()
		}
		await expect(page.getByRole('dialog', { name: 'Новое пространство' })).toBeVisible()
		await expectNoOverflow(page, 'диалог пространства')
		await shot(page, info, 'dialog-space')
	})

	test('нет переполнения с открытым чатом агента', async ({ page, ws, narrow }, info) => {
		const a = await ws.spawn(`ch-${uid()}`, '#tools')
		await openApp(page)
		await openChat(page, a, narrow)
		await expect(page.getByRole('region', { name: 'Чат агента' }).getByText('Готово: README прочитан')).toBeVisible()
		await expectNoOverflow(page, 'чат')
		await shot(page, info, 'chat-tools')
	})
})

test.describe('стресс-раскладка', () => {
	test('длинные имена и неразрывные строки не ломают раскладку', async ({ page, ws, narrow }, info) => {
		const long = `very-long-agent-name-${uid()}-${'x'.repeat(40)}`
		const a = await ws.spawn(long, `#shell ${'a'.repeat(120)}`)
		await openApp(page)
		await expectNoOverflow(page, 'граф с длинным именем')
		if (narrow) await tab(page, 'Лента').click()
		await expectNoOverflow(page, 'лента с длинными строками')
		await shot(page, info, 'long-feed')
		await openChat(page, a, narrow)
		await expect(page.getByRole('region', { name: 'Чат агента' }).getByText(`выполнено: ${'a'.repeat(120)}`)).toBeVisible()
		await expectNoOverflow(page, 'чат с длинными строками')
		await shot(page, info, 'long-chat')
	})

	test('выдвижной ростер (средняя ширина) и меню/поповеры', async ({ page, ws, narrow }, info) => {
		await ws.spawn(`pp-${uid()}`, 'x')
		await openApp(page)
		const drawer = page.getByRole('button', { name: 'Показать список агентов' })
		if (await drawer.isVisible()) {
			await drawer.click()
			await expectNoOverflow(page, 'выдвижной ростер')
			await shot(page, info, 'drawer')
			await page.getByRole('button', { name: 'Скрыть список агентов' }).click()
		}
		if (narrow) {
			await page.getByRole('button', { name: 'Меню' }).click()
			await page.getByRole('dialog', { name: 'Меню' }).getByRole('button', { name: new RegExp(ws.name) }).click()
			await expectNoOverflow(page, 'меню с деталями пространства')
			await shot(page, info, 'menu-space-details')
		} else {
			await page.getByRole('list', { name: 'Пространства' }).getByRole('button', { name: new RegExp(ws.name) }).click()
			await expect(page.getByRole('dialog', { name: `Пространство ${ws.name}` })).toBeVisible()
			await expectNoOverflow(page, 'карточка пространства')
			await shot(page, info, 'space-details')
		}
	})
})
