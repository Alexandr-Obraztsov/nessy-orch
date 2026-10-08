import { expect, expectNoOverflow, openApp, shot, tab, test, uid } from './fixtures'

test.describe('лента', () => {
	test('отправка из композера ленты: ответ агента появляется, фильтр работает', async ({ page, ws, narrow }, info) => {
		const a = await ws.spawn(`fd-${uid()}`)
		await openApp(page)
		if (narrow) await tab(page, 'Лента').click()
		const feed = page.getByRole('region', { name: 'Общая лента' })
		await expect(feed).toBeVisible()

		// адресат — выбираем чип «Кому»
		await feed.getByRole('radio', { name: new RegExp(a.name) }).click()
		const text = `ping-${uid()}`
		await feed.getByRole('textbox').fill(text)
		await feed.getByRole('button', { name: 'Отправить' }).click()
		await expect(feed.getByText(text).first()).toBeVisible()
		await expect(feed.getByText(`ответ: ${text}`)).toBeVisible()
		await expectNoOverflow(page, 'лента')
		await shot(page, info, 'feed')

		// фильтр: «Система» скрывает переписку, «Мои» возвращает
		const tabsList = feed.getByRole('tablist', { name: 'Фильтр ленты' })
		await tabsList.getByRole('tab', { name: 'Система' }).click()
		await expect(tabsList.getByRole('tab', { name: 'Система' })).toHaveAttribute('aria-selected', 'true')
		await expect(feed.getByText(`ответ: ${text}`)).toHaveCount(0)
		await tabsList.getByRole('tab', { name: 'Мои' }).click()
		await expect(feed.getByText(`ответ: ${text}`)).toBeVisible()
		await tabsList.getByRole('tab', { name: 'Все' }).click()
	})
})
