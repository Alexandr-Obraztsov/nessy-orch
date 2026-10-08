/**
 * Роли: создание во вкладке-редакторе, проверка полей, правка и предпросмотр,
 * запуск агента с ролью, удаление.
 */
import { chat, createRole, expect, expectNoOverflow, openApp, openWithTabs, row, section, shot, tab, test, uid } from './fixtures'

const editor = (page: import('@playwright/test').Page) => page.getByRole('tabpanel')

test.describe('роли', () => {
	test('новая роль: проверка полей, сохранение, появляется в списке', async ({ page, narrow }, info) => {
		const name = `Ревьюер ${uid()}`
		await openApp(page)
		const roles = await section(page, narrow, 'Роли')
		await roles.getByRole('button', { name: 'Новая роль' }).click()
		const ed = editor(page)
		await expect(ed.getByLabel('Название роли')).toBeFocused()

		// пустая роль не сохраняется
		await ed.getByRole('button', { name: 'Сохранить' }).click()
		await expect(ed.getByText('Назовите роль')).toBeVisible()

		await ed.getByLabel('Название роли').fill(name)
		await ed.getByLabel('Описание роли').fill('Проверяет код')
		await ed.getByRole('radio', { name: 'Оттенок 145' }).click()
		await ed.getByRole('button', { name: 'Сохранить' }).click()
		await expect(ed.getByText('Напишите инструкции')).toBeVisible()
		await ed.getByLabel('Инструкции').fill('# Ты — ревьюер\n\n- проверяй **тесты**')
		await expectNoOverflow(page, 'редактор роли')
		await shot(page, info, 'role-new')
		await page.keyboard.press('Control+s')

		await expect(ed.getByText('Сохранено')).toBeAttached()
		if (!narrow) await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true')
		else await expect(page.getByRole('banner')).toContainText(name)
		await expect(row(await section(page, narrow, 'Роли'), name)).toBeVisible()
		await shot(page, info, 'role-saved')
	})

	test('правка роли и предпросмотр markdown', async ({ page, request }, info) => {
		const role = await createRole(request, `Писатель ${uid()}`, '## Заголовок\n\nтекст')
		await openWithTabs(page, [{ kind: 'feed' }, { kind: 'role', id: role.id }])
		const ed = editor(page)
		await expect(ed.getByLabel('Название роли')).toHaveValue(role.name)
		await ed.getByLabel('Описание роли').fill('Пишет документацию')
		await expect(ed.getByText('Не сохранено')).toBeAttached()
		await ed.getByRole('button', { name: 'Сохранить' }).click()
		await expect(ed.getByText('Сохранено')).toBeAttached()

		await ed.getByRole('button', { name: /Предпросмотр/ }).click()
		await expect(ed.getByRole('heading', { name: 'Заголовок' })).toBeVisible()
		await shot(page, info, 'role-preview')

		const res = await request.get('/roles')
		const list = (await res.json()) as { id: string; description: string }[]
		expect(list.find(r => r.id === role.id)?.description).toBe('Пишет документацию')
	})

	test('запуск агента с ролью из редактора', async ({ page, request, ws }, info) => {
		const role = await createRole(request, `Тестер ${uid()}`)
		await openWithTabs(page, [{ kind: 'feed' }, { kind: 'role', id: role.id }])
		await editor(page).getByRole('button', { name: /Запустить/ }).click()
		const dlg = page.getByRole('dialog', { name: 'Новый агент' })
		await expect(dlg.getByRole('radio', { name: new RegExp(role.name) })).toBeChecked()
		await dlg.getByLabel('Пространство').selectOption(ws.name)
		const name = `rl-${uid()}`
		await dlg.getByLabel('Имя').fill(name)
		await shot(page, info, 'spawn-with-role')
		await dlg.getByRole('button', { name: 'Запустить' }).click()
		await expect(dlg).toBeHidden()
		await expect(chat(page).getByRole('heading', { name })).toBeVisible()

		const res = await request.get('/graph')
		const g = (await res.json()) as { agents: { name: string; role: string | null }[] }
		expect(g.agents.find(a => a.name === name)?.role).toBe(role.id)

		// в редакторе роли агент виден в «Агенты»
		await openWithTabs(page, [{ kind: 'feed' }, { kind: 'role', id: role.id }])
		await expect(editor(page).getByRole('button', { name })).toBeVisible()
	})

	test('удаление роли с подтверждением закрывает вкладку', async ({ page, request, narrow }) => {
		const role = await createRole(request, `Удаляемая ${uid()}`)
		await openWithTabs(page, [{ kind: 'feed' }, { kind: 'role', id: role.id }])
		await editor(page).getByRole('button', { name: 'Удалить роль' }).click()
		const dlg = page.getByRole('dialog', { name: `Удалить роль «${role.name}»?` })
		await dlg.getByRole('button', { name: 'Удалить' }).click()
		await expect(dlg).toBeHidden()
		if (!narrow) await expect(tab(page, role.name)).toHaveCount(0)
		await expect(row(await section(page, narrow, 'Роли'), role.name)).toHaveCount(0)
	})
})
