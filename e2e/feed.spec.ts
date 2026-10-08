/**
 * Лента: ваши сообщения, свёрнутые ответы агентов, раскрытие, переключатели
 * «Переписка агентов» / «Системные», выбор адресата (в том числе из архива).
 */
import type { Page } from '@playwright/test'
import { expect, expectNoOverflow, openApp, shot, test, uid } from './fixtures'

/** Открыть приложение сразу на вкладке «Лента» с заданными опциями. */
async function openFeedTab(page: Page, opts: { agentChatter?: boolean; system?: boolean } = {}) {
	await page.goto('/')
	await page.evaluate(o => {
		localStorage.setItem('nessy-orch:view', JSON.stringify({ tabs: [{ kind: 'feed' }], active: 0, feed: { agentChatter: false, system: false, ...o } }))
	}, opts)
	await openApp(page)
	const feed = page.getByRole('region', { name: 'Лента' })
	await expect(feed).toBeVisible()
	return feed
}

test.describe('лента', () => {
	test('сообщение агенту: ваша строка и свёрнутый ответ, раскрытие и «Открыть чат»', async ({ page, ws }, info) => {
		const a = await ws.spawn(`fd-${uid()}`)
		const feed = await openFeedTab(page)

		// адресат — через «Кому: … ▾»
		await feed.getByRole('button', { name: /^Кому/ }).click()
		await page.getByRole('listbox', { name: 'Адресат' }).getByRole('option', { name: new RegExp(a.name) }).click()
		await expect(feed.getByRole('button', { name: `Кому: ${a.name}` })).toBeVisible()

		const text = `ping-${uid()}`
		const input = feed.locator('textarea[data-composer]')
		await input.fill(text)
		await input.press('Enter')
		await expect(input).toHaveValue('')

		// ваша строка: «Вы → агент», текст
		const mine = feed.locator('[data-msg]').filter({ hasText: text }).first()
		await expect(mine).toContainText('Вы')
		await expect(mine).toContainText(a.name)

		// ответ свёрнут: одна строка с превью, полный markdown не показан
		const card = feed.getByRole('article', { name: new RegExp(`ответ от ${a.name}`) }).last()
		await expect(card).toContainText(`ответ: ${text}`)
		const toggle = card.getByRole('button', { name: 'Развернуть' })
		await expect(toggle).toHaveAttribute('aria-expanded', 'false')
		await expectNoOverflow(page, 'лента')
		await shot(page, info, 'feed-collapsed')

		// раскрытие: цитата запроса, «Свернуть», «Открыть чат»
		await toggle.click()
		await expect(card.getByRole('button', { name: 'Свернуть' }).first()).toBeVisible()
		await expect(card).toContainText(text)
		await shot(page, info, 'feed-expanded')
		await card.getByRole('button', { name: 'Свернуть' }).last().click()
		await expect(card.getByRole('button', { name: 'Развернуть' })).toBeVisible()

		// Enter на кнопке раскрытия тоже работает; раскрытие переживает смену вкладки
		await card.getByRole('button', { name: 'Развернуть' }).press('Enter')
		await card.getByRole('button', { name: 'Открыть чат' }).click()
		await expect(page.getByRole('region', { name: 'Чат агента' })).toBeVisible()
		await expect(page.getByRole('region', { name: 'Чат агента' }).getByRole('heading', { name: a.name })).toBeVisible()
	})

	test('переписка агентов и системные события скрыты по умолчанию', async ({ page, ws, request }) => {
		const a = await ws.spawn(`fa-${uid()}`)
		const b = await ws.spawn(`fb-${uid()}`)
		const chatter = `между-${uid()}`
		const r = await request.post(`/agents/${b.id}/send`, { data: { from: a.id, text: chatter } })
		expect(r.ok(), await r.text()).toBe(true)

		const feed = await openFeedTab(page)
		const chatterToggle = feed.getByRole('button', { name: 'Переписка агентов' })
		const systemToggle = feed.getByRole('button', { name: 'Системные' })
		await expect(chatterToggle).toHaveAttribute('aria-pressed', 'false')
		await expect(feed.getByText(`создал агента ${a.name}`)).toHaveCount(0)
		await expect(feed.locator('[data-msg]').filter({ hasText: chatter })).toHaveCount(0)

		await chatterToggle.click()
		await expect(chatterToggle).toHaveAttribute('aria-pressed', 'true')
		const card = feed.getByRole('article', { name: new RegExp(`сообщение от ${a.name}`) })
		await expect(card).toContainText(chatter)
		await expect(card).toContainText(b.name)

		await systemToggle.click()
		await expect(feed.getByText(`создал агента ${a.name}`)).toBeVisible()

		// настройки запоминаются
		await page.reload()
		await expect(page.getByRole('region', { name: 'Лента' }).getByRole('button', { name: 'Системные' })).toHaveAttribute('aria-pressed', 'true')
		await systemToggle.click()
		await chatterToggle.click()
		await expect(feed.getByText(`создал агента ${a.name}`)).toHaveCount(0)
	})

	test('«@имя » выбирает адресата; архивный агент просыпается от сообщения', async ({ page, ws, request }) => {
		const a = await ws.spawn(`fz-${uid()}`)
		const r = await request.post(`/agents/${a.id}/archive`)
		expect(r.ok(), await r.text()).toBe(true)

		const feed = await openFeedTab(page)
		await feed.getByRole('button', { name: /^Кому/ }).click()
		const list = page.getByRole('listbox', { name: 'Адресат' })
		await expect(list.getByText('Архив — проснётся при отправке')).toBeVisible()
		await page.keyboard.press('Escape')

		const input = feed.locator('textarea[data-composer]')
		const text = `wake-${uid()}`
		await input.fill(`@${a.name} ${text}`)
		await expect(feed.getByRole('button', { name: `Кому: ${a.name}` })).toBeVisible()
		await expect(feed.getByRole('note')).toContainText('проснётся с прежним контекстом')
		await input.press('Enter')

		await expect(feed.getByRole('article', { name: new RegExp(`ответ от ${a.name}`) }).last()).toContainText(`ответ: ${text}`)
		await expect.poll(async () => ((await (await request.get('/graph')).json()) as { agents: { id: string; archived: boolean }[] }).agents.find(x => x.id === a.id)?.archived).toBe(false)
	})
})
