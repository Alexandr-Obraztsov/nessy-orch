/**
 * Агенты: запуск через диалог, дерево в левой панели, архив и возврат, удаление, поиск, граф.
 */
import { chat, expect, expectNoOverflow, openApp, openSpawnDialog, openWithTabs, row, section, shot, sidebar, test, uid } from './fixtures'

test.describe('агенты', () => {
	test('запуск через диалог: открывается вкладка агента, после ответа — в архиве', async ({ page, ws, narrow }, info) => {
		const name = `sp-${uid()}`
		await openApp(page)
		const dlg = await openSpawnDialog(page, narrow)
		await expect(dlg.getByRole('radio', { name: /Без роли/ })).toBeChecked()
		await dlg.getByLabel('Пространство').selectOption(ws.name)
		await dlg.getByLabel('Имя').fill(name)
		await dlg.getByLabel('Задача').fill('привет из e2e')
		await shot(page, info, 'spawn-filled')
		await dlg.getByLabel('Задача').press('Control+Enter')
		await expect(dlg).toBeHidden()

		const c = chat(page)
		await expect(c.getByRole('heading', { name })).toBeVisible()
		await expect(c.getByText('ответ: привет из e2e')).toBeVisible()
		await expectNoOverflow(page, 'чат после запуска')

		// выполнил задачу — ушёл в архив (свёрнутая секция)
		const archive = await section(page, narrow, 'Архив')
		await expect(row(archive, name)).toBeVisible()
		await shot(page, info, 'archive-section')
	})

	test('дерево: агенты по папкам пространств, папка сворачивается', async ({ page, ws, narrow }, info) => {
		const a = await ws.spawn(`tr-${uid()}`)
		await openApp(page)
		const agents = await section(page, narrow, 'Агенты')
		const folder = agents.getByRole('group', { name: `Пространство ${ws.name}` })
		await expect(row(folder, a.name)).toBeVisible()
		await shot(page, info, 'tree')
		await folder.getByRole('button', { name: new RegExp(`^${ws.name}`) }).click()
		await expect(row(folder, a.name)).toBeHidden()
		await folder.getByRole('button', { name: new RegExp(`^${ws.name}`) }).click()
		await expect(row(folder, a.name)).toBeVisible()
	})

	test('меню агента: архивировать → вернуть → удалить с подтверждением', async ({ page, ws, narrow }, info) => {
		const a = await ws.spawn(`mn-${uid()}`)
		await openApp(page)
		const agents = await section(page, narrow, 'Агенты')
		await row(agents, a.name).hover()
		await page.getByRole('button', { name: `Действия: ${a.name}` }).click()
		const menu = page.getByRole('menu', { name: `Действия: ${a.name}` })
		await expect(menu).toBeVisible()
		await expectNoOverflow(page, 'меню агента')
		await shot(page, info, 'agent-menu')
		await menu.getByRole('menuitem', { name: 'Архивировать' }).click()
		await expect(row(agents, a.name)).toHaveCount(0)

		const archive = await section(page, narrow, 'Архив')
		await expect(row(archive, a.name)).toBeVisible()
		await row(archive, a.name).hover()
		await page.getByRole('button', { name: `Действия: ${a.name}` }).click()
		await page.getByRole('menuitem', { name: 'Вернуть из архива' }).click()
		await expect(row(agents, a.name)).toBeVisible()

		// правый клик открывает то же меню
		await row(agents, a.name).click({ button: 'right' })
		await page.getByRole('menuitem', { name: 'Удалить…' }).click()
		const dlg = page.getByRole('dialog', { name: `Удалить агента ${a.name}?` })
		await expect(dlg).toBeVisible()
		await shot(page, info, 'confirm-delete')
		await dlg.getByRole('button', { name: 'Удалить' }).click()
		await expect(dlg).toBeHidden()
		await expect(row(await sidebar(page, narrow), a.name)).toHaveCount(0)
	})

	test('поиск фильтрует агентов, роли и пространства', async ({ page, ws, narrow }, info) => {
		const tag = uid()
		const a = await ws.spawn(`find-${tag}`)
		const b = await ws.spawn(`other-${uid()}`)
		await openApp(page)
		const nav = await sidebar(page, narrow)
		await nav.getByLabel('Поиск по агентам, ролям и пространствам').fill(tag)
		await expect(row(nav, a.name)).toBeVisible()
		await expect(row(nav, b.name)).toHaveCount(0)
		await shot(page, info, 'search')
		await nav.getByLabel('Поиск по агентам, ролям и пространствам').fill(`nothing-${uid()}`)
		await expect(nav.getByText(/ничего не найдено/)).toBeVisible()
		await nav.getByRole('button', { name: 'Очистить поиск' }).click()
		await expect(row(nav, b.name)).toBeVisible()
	})
})

test.describe('граф', () => {
	test('узлы рисуются, Enter на узле открывает агента, «Вы» — ленту', async ({ page, ws }, info) => {
		const a = await ws.spawn(`gr-${uid()}`)
		await openWithTabs(page, [{ kind: 'feed' }, { kind: 'graph' }])
		const node = page.locator(`[data-node="${a.id}"]`)
		await expect(node).toBeAttached()
		await expect(page.locator('[data-node="you"]')).toBeAttached()
		await page.waitForTimeout(800)
		await shot(page, info, 'graph')

		await node.focus()
		await page.keyboard.press('Enter')
		await expect(chat(page).getByRole('heading', { name: a.name })).toBeVisible()

		await openWithTabs(page, [{ kind: 'feed' }, { kind: 'graph' }])
		await page.locator('[data-node="you"]').focus()
		await page.keyboard.press('Enter')
		await expect(page.getByRole('region', { name: 'Лента' })).toBeVisible()
	})

	test('клик/тап по узлу открывает агента', async ({ page, ws, hasTouch }) => {
		const a = await ws.spawn(`tp-${uid()}`)
		await openWithTabs(page, [{ kind: 'feed' }, { kind: 'graph' }])
		const dot = page.locator(`[data-node="${a.id}"] circle`).last()
		await expect(dot).toBeVisible()
		await page.waitForTimeout(1500)
		const box = await dot.boundingBox()
		expect(box).not.toBeNull()
		if (!box) return
		const x = box.x + box.width / 2
		const y = box.y + box.height / 2
		if (hasTouch) await page.touchscreen.tap(x, y)
		else await page.mouse.click(x, y)
		await expect(chat(page).getByRole('heading', { name: a.name })).toBeVisible()
	})

	test('архивные агенты скрыты, пока не включён «Показать архив»', async ({ page, ws }, info) => {
		const a = await ws.spawn(`ga-${uid()}`)
		await page.request.post(`/agents/${a.id}/archive`)
		await openWithTabs(page, [{ kind: 'feed' }, { kind: 'graph' }])
		await expect(page.locator('[data-node="you"]')).toBeAttached()
		await expect(page.locator(`[data-node="${a.id}"]`)).toHaveCount(0)
		await page.getByRole('button', { name: 'Настройки графа' }).click()
		const pop = page.getByRole('dialog', { name: 'Настройки графа' })
		await pop.getByText('Показать архив', { exact: true }).click()
		await expect(pop.getByRole('switch', { name: /Показать архив/ })).toBeChecked()
		await expect(page.locator(`[data-node="${a.id}"]`)).toBeAttached()
		await shot(page, info, 'graph-settings')
		await pop.getByText('Показать архив', { exact: true }).click()
		await expect(page.locator(`[data-node="${a.id}"]`)).toHaveCount(0)
	})
})
