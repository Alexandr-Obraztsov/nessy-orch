/**
 * Визуальный обход ключевых состояний в обеих темах: скриншоты в test-results/shots/<project>/.
 * Проверки — только отсутствие горизонтального переполнения и ошибок консоли.
 */
import { createRole, expect, expectNoOverflow, openSpawnDialog, openWithTabs, section, shot, test, uid } from './fixtures'

for (const theme of ['dark', 'light'] as const) {
	test(`обход состояний, тема ${theme}`, async ({ page, request, ws, narrow }, info) => {
		test.setTimeout(90_000)
		await page.addInitScript(t => localStorage.setItem('nessy-orch:theme', t), theme)
		const role = await createRole(request, `Ревьюер ${uid()}`, '# Ты — ревьюер\n\n- проверяй тесты\n- отвечай списком', 'Проверяет код')
		const lead = await ws.spawn(`vl-${uid()}`, undefined, { role: role.id })
		await ws.spawn(`vs-${uid()}`, '#slow', { parent: lead.id })
		await ws.spawn(`vi-${uid()}`, undefined, { parent: lead.id })
		const done = await ws.spawn(`vd-${uid()}`, 'готово')
		const s = (n: string): Promise<void> => shot(page, info, `${theme}-${n}`)

		await openWithTabs(page, [{ kind: 'feed' }, { kind: 'graph' }, { kind: 'agent', id: lead.id }, { kind: 'role', id: role.id }], 1)
		await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
		await expect(page.locator(`[data-node="${lead.id}"]`)).toBeAttached()
		await page.waitForTimeout(1500)
		await s('graph')
		await expectNoOverflow(page, 'граф')

		await openWithTabs(page, [{ kind: 'feed' }, { kind: 'graph' }, { kind: 'agent', id: lead.id }, { kind: 'role', id: role.id }], 3)
		await expect(page.getByLabel('Название роли')).toHaveValue(role.name)
		await s('role')
		await expectNoOverflow(page, 'роль')

		await openWithTabs(page, [{ kind: 'feed' }], 0)
		const archive = await section(page, narrow, 'Архив')
		await expect(archive.getByRole('button', { name: done.name, exact: true })).toBeVisible()
		await s('sidebar')
		await expectNoOverflow(page, 'панель')
		if (narrow) await page.keyboard.press('Escape')

		const dlg = await openSpawnDialog(page, narrow)
		await dlg.getByLabel('Задача').fill('Длинная задача для проверки переноса строк в поле ввода на малых экранах')
		await s('dialog-spawn')
		await expectNoOverflow(page, 'диалог')
		await dlg.getByRole('button', { name: 'Отмена' }).click()
	})
}
