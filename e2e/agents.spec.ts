import { chat, expect, expectNoOverflow, openApp, openChat, openSpawnDialog, shot, tab, test, uid } from './fixtures'

test.describe('агенты', () => {
	test('запуск агента через диалог: появляется в ростере, открывается чат, ответ стримится', async ({ page, ws, narrow }, info) => {
		const name = `sp-${uid()}`
		await openApp(page)
		const dlg = await openSpawnDialog(page, narrow)
		await dlg.getByText(ws.name, { exact: true }).click()
		await dlg.getByLabel('Имя').fill(name)
		await dlg.getByLabel('Задача').fill('привет из e2e')
		await shot(page, info, 'spawn-filled')
		await dlg.getByRole('button', { name: 'Запустить' }).click()
		await expect(dlg).toBeHidden()

		// агент в ростере (на узких — вкладка «Агенты»)
		if (narrow) await tab(page, 'Агенты').click()
		else if (!(await page.getByRole('complementary', { name: 'Агенты' }).isVisible())) {
			await page.getByRole('button', { name: 'Показать список агентов' }).click()
		}
		const row = page.getByRole('complementary', { name: 'Агенты' }).getByRole('button').filter({ hasText: name })
		await expect(row).toBeVisible()
		await row.click()

		await expect(chat(page)).toBeVisible()
		await expect(chat(page).getByRole('heading', { name })).toBeVisible()
		await expect(chat(page).getByText('ответ: привет из e2e')).toBeVisible()
		await expectNoOverflow(page, 'чат после запуска')
		await shot(page, info, 'spawned-chat')
	})

	test('граф: узел агента рисуется, клик открывает чат; «Вы» возвращает в ленту', async ({ page, ws, narrow }, info) => {
		const a = await ws.spawn(`gr-${uid()}`, 'граф')
		await openApp(page)
		if (narrow) await tab(page, 'Граф').click()
		const node = page.locator(`[data-node="${a.id}"]`)
		await expect(node).toBeAttached()
		await expect(page.locator('[data-node="you"]')).toBeAttached()
		await shot(page, info, 'graph')

		// узлы двигает симуляция: клик через DOM-событие устойчивее клика по координатам
		await node.focus()
		await page.keyboard.press('Enter')
		await expect(chat(page)).toBeVisible()
		await expect(chat(page).getByRole('heading', { name: a.name })).toBeVisible()

		if (!narrow) {
			await page.locator('[data-node="you"]').focus()
			await page.keyboard.press('Enter')
			await expect(page.getByRole('region', { name: 'Общая лента' })).toBeVisible()
		}
	})

	test('графовый узел по тапу/клику мышью открывает чат', async ({ page, ws, narrow }) => {
		const a = await ws.spawn(`tp-${uid()}`, 'тап')
		await openApp(page)
		if (narrow) await tab(page, 'Граф').click()
		const node = page.locator(`[data-node="${a.id}"] circle[class*="disc"]`)
		await expect(node).toBeVisible()
		// ждём, пока симуляция успокоится
		await page.waitForTimeout(1500)
		const box = await node.boundingBox()
		expect(box).not.toBeNull()
		if (!box) return
		const x = box.x + box.width / 2
		const y = box.y + box.height / 2
		if (narrow) await page.touchscreen.tap(x, y)
		else await page.mouse.click(x, y)
		await expect(chat(page).getByRole('heading', { name: a.name })).toBeVisible()
	})

	test('чат: #tools — карточки инструментов раскрываются и показывают вывод', async ({ page, ws, narrow }, info) => {
		const a = await ws.spawn(`tl-${uid()}`, '#tools')
		await openApp(page)
		await openChat(page, a, narrow)
		const c = chat(page)
		const cards = c.getByRole('button', { expanded: false }).filter({ hasText: /read_file|grep|run_shell_command/ })
		await expect(cards).toHaveCount(3)
		await expect(c.getByText('Готово: README прочитан')).toBeVisible()
		await cards.first().click()
		await expect(c.getByText('Оркестратор агентов nessy.')).toBeVisible()
		await cards.nth(0).click() // после раскрытия первый уже expanded=true, поэтому берём оставшиеся
		await c.getByRole('button', { name: /run_shell_command/ }).click()
		await expect(c.getByText('pass 42')).toBeVisible()
		await expectNoOverflow(page, 'карточки инструментов')
		await shot(page, info, 'tools-expanded')
	})

	test('чат: #long — markdown (таблица, код, заголовок)', async ({ page, ws, narrow }, info) => {
		const a = await ws.spawn(`lg-${uid()}`, '#long')
		await openApp(page)
		await openChat(page, a, narrow)
		const c = chat(page)
		await expect(c.getByRole('heading', { name: 'План проверки' })).toBeVisible({ timeout: 15_000 })
		await expect(c.getByRole('table')).toBeVisible({ timeout: 15_000 })
		await expect(c.locator('pre code')).toContainText('SseParser', { timeout: 15_000 })
		await expect(c.getByText('Итог: можно мержить')).toBeVisible({ timeout: 15_000 })
		await expectNoOverflow(page, 'markdown')
		await shot(page, info, 'markdown')
	})

	test('чат: #slow и отмена через действия — «ход прерван»', async ({ page, ws, narrow }, info) => {
		const a = await ws.spawn(`sl-${uid()}`)
		await openApp(page)
		await openChat(page, a, narrow)
		const c = chat(page)
		await c.getByLabel(`Сообщение для ${a.name}`).fill('#slow')
		await c.getByRole('button', { name: 'Отправить' }).click()
		await c.getByRole('button', { name: 'Действия' }).click()
		await shot(page, info, 'actions-menu')
		const item = c.getByRole('menuitem', { name: 'Прервать ход' })
		await expect(item).toBeEnabled()
		await item.click()
		await expect(c.getByText(/ход прерван/i)).toBeVisible()
	})

	test('чат: удаление агента с подтверждением', async ({ page, ws, narrow }, info) => {
		const a = await ws.spawn(`dl-${uid()}`)
		await openApp(page)
		await openChat(page, a, narrow)
		await chat(page).getByRole('button', { name: 'Действия' }).click()
		await chat(page).getByRole('menuitem', { name: /Удалить агента/ }).click()
		const dlg = page.getByRole('dialog', { name: new RegExp(`Удалить агента ${a.name}`) })
		await expect(dlg).toBeVisible()
		await expectNoOverflow(page, 'подтверждение удаления')
		await shot(page, info, 'confirm-delete')
		await dlg.getByRole('button', { name: 'Удалить' }).click()
		await expect(dlg).toBeHidden()
		await expect(page.locator(`[data-node="${a.id}"]`)).toHaveCount(0)
	})
})
