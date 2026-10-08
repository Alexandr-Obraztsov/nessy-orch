/**
 * Визуальный обход ключевых состояний в обеих темах: скриншоты в test-results/shots/<project>/.
 * Проверки — только отсутствие горизонтального переполнения и ошибок консоли.
 */
import { chat, expect, expectNoOverflow, openApp, openChat, openSpawnDialog, shot, tab, test, uid } from './fixtures'

for (const theme of ['dark', 'light'] as const) {
	test(`обход состояний, тема ${theme}`, async ({ page, ws, narrow }, info) => {
		test.setTimeout(90_000)
		await page.addInitScript(t => localStorage.setItem('nessy-orch:theme', t), theme)
		const tools = await ws.spawn(`vt-${uid()}`, '#tools')
		const long = await ws.spawn(`vl-${uid()}`, '#long')
		await ws.spawn(`vs-${uid()}`, '#slow')
		await openApp(page)
		await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
		const s = (n: string): Promise<void> => shot(page, info, `${theme}-${n}`)

		if (narrow) await tab(page, 'Граф').click()
		await page.waitForTimeout(1800)
		await s('graph')
		await expectNoOverflow(page, 'граф')

		if (narrow) {
			await tab(page, 'Агенты').click()
			await s('roster')
			await tab(page, 'Лента').click()
		}
		await s('feed')

		await openChat(page, tools, narrow)
		await expect(chat(page).getByText('Готово: README прочитан')).toBeVisible()
		await chat(page).getByRole('button', { name: /run_shell_command/ }).click()
		await s('chat-tools')
		await expectNoOverflow(page, 'чат-инструменты')

		if (narrow) await tab(page, 'Агенты').click()
		await openChat(page, long, narrow)
		await expect(chat(page).getByText('Итог: можно мержить')).toBeVisible({ timeout: 15_000 })
		await s('chat-markdown')
		await expectNoOverflow(page, 'чат-markdown')

		const dlg = await openSpawnDialog(page, narrow)
		await dlg.getByLabel('Задача').fill('Длинная задача для проверки переноса строк в поле ввода на малых экранах')
		await s('dialog-spawn')
		await dlg.getByRole('button', { name: 'Отмена' }).click()
		await expectNoOverflow(page, 'после диалога')
	})
}
