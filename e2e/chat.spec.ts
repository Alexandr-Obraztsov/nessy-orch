/**
 * Чат агента: шапка, инструменты (строки с раскрытием), длинный markdown, прерывание хода
 * новым сообщением, архив и возврат.
 */
import type { Page } from '@playwright/test'
import { expect, expectNoOverflow, shot, test, uid, type Agent } from './fixtures'

/** Открыть вкладку агента напрямую (через сохранённые вкладки), не завися от боковой панели. */
async function openAgentTab(page: Page, agent: Agent) {
	await page.goto('/')
	await page.evaluate(id => {
		localStorage.setItem('nessy-orch:view', JSON.stringify({ tabs: [{ kind: 'feed' }, { kind: 'agent', id }], active: 1, feed: { agentChatter: false, system: false } }))
	}, agent.id)
	await page.reload()
	const chat = page.getByRole('region', { name: 'Чат агента' })
	await expect(chat.getByRole('heading', { name: agent.name })).toBeVisible()
	return chat
}

test.describe('чат агента', () => {
	test('инструменты — строки с раскрытием ввода и вывода, мысли свёрнуты', async ({ page, ws }, info) => {
		const a = await ws.spawn(`ct-${uid()}`)
		const chat = await openAgentTab(page, a)
		const input = chat.locator('textarea[data-composer]')
		await input.fill('#tools')
		await input.press('Enter')

		await expect(chat.getByText('Готово: README прочитан, найдено 2 TODO, тесты зелёные.')).toBeVisible()
		const tool = chat.locator('[data-tool]').filter({ hasText: 'Shell: npm test' })
		await expect(tool).toBeVisible()
		await expect(tool.getByLabel('готово')).toBeVisible()
		await expect(chat.locator('[data-tool]')).toHaveCount(3)
		await expect(chat.getByRole('button', { name: /Размышления/ }).first()).toBeVisible()

		await tool.getByRole('button').click()
		await expect(tool.getByText('tests 42')).toBeVisible()
		await expectNoOverflow(page, 'чат: инструменты')
		await shot(page, info, 'chat-tools')
	})

	test('длинный markdown в чате и свёрнутый ответ в ленте', async ({ page, ws }, info) => {
		const a = await ws.spawn(`cl-${uid()}`)
		const chat = await openAgentTab(page, a)
		const input = chat.locator('textarea[data-composer]')
		await input.fill('#long')
		await input.press('Enter')
		await expect(chat.locator('table')).toBeVisible({ timeout: 15_000 })
		await expect(chat.locator('pre').first()).toBeVisible()
		await expectNoOverflow(page, 'чат: markdown')
		await shot(page, info, 'chat-markdown')

		// в ленте — одна строка превью без разметки
		await page.evaluate(() => {
			localStorage.setItem('nessy-orch:view', JSON.stringify({ tabs: [{ kind: 'feed' }], active: 0, feed: { agentChatter: false, system: false } }))
		})
		await page.reload()
		const feed = page.getByRole('region', { name: 'Лента' })
		const card = feed.getByRole('article', { name: new RegExp(`ответ от ${a.name}`) }).last()
		await expect(card).toBeVisible()
		await expect(card.locator('table')).toHaveCount(0)
		const preview = (await card.getByRole('button', { name: 'Развернуть' }).innerText()).trim()
		expect(preview).not.toMatch(/\|\s*-{3}|```|^#/)
	})

	test('сообщение работающему агенту прерывает ход и обрабатывается', async ({ page, ws }, info) => {
		const a = await ws.spawn(`ci-${uid()}`)
		const chat = await openAgentTab(page, a)
		const input = chat.locator('textarea[data-composer]')
		await input.fill('#slow')
		await input.press('Enter')
		await expect(chat.getByRole('note')).toContainText('сообщение прервёт текущий ход')
		await expect(chat.getByRole('button', { name: /Прервать/ })).toBeVisible()
		await shot(page, info, 'chat-working')

		const text = `срочно-${uid()}`
		await input.fill(text)
		await input.press('Enter')
		await expect(chat.getByText('ход прерван').first()).toBeVisible()
		await expect(chat.getByText(`ответ: ${text}`)).toBeVisible()
		// ход закончен — подсказки о прерывании больше нет
		await expect(chat.getByRole('note').filter({ hasText: 'прервёт' })).toHaveCount(0)
	})

	test('архив: метка в шапке, подсказка «проснётся», возврат', async ({ page, ws }, info) => {
		const a = await ws.spawn(`ca-${uid()}`)
		const chat = await openAgentTab(page, a)
		await chat.getByRole('button', { name: /В архив/ }).click()
		await expect(chat.getByText('в архиве', { exact: true })).toBeVisible()
		await expect(chat.getByRole('note')).toContainText('проснётся с прежним контекстом')
		await shot(page, info, 'chat-archived')

		await chat.getByRole('button', { name: /Вернуть/ }).click()
		await expect(chat.getByText('в архиве', { exact: true })).toHaveCount(0)
		await expect(chat.getByRole('button', { name: /В архив/ })).toBeVisible()
	})
})
