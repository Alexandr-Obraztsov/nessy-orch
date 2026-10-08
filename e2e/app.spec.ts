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
			await page.getByRole('button', { name: /Пространство/ }).click()
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
