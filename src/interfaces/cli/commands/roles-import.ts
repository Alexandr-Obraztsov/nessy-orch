/** Импорт пресетов ролей: разбор markdown и заливка через API (создать / пропустить / перезаписать). */
import type { RoleRequest } from '../../../../shared/types'
import { parseRolePreset } from '../../../domain/role-presets'
import type { RolePresetFile } from '../../../domain/types'
import { errMsg } from '../../../lib/json'
import type { ImportOptions, ImportRow, RolesApi } from './roles-import.types'

export async function importRolePresets(files: readonly RolePresetFile[], api: RolesApi, opts: ImportOptions): Promise<ImportRow[]> {
	const known = new Set((await api.list()).map(r => r.id))
	const rows: ImportRow[] = []
	for (const f of files) {
		let req: RoleRequest
		try {
			req = parseRolePreset(f.text)
		} catch (e) {
			rows.push({ id: f.source, name: '', outcome: 'invalid', action: `пропущена: ${errMsg(e)}` })
			continue
		}
		const id = req.id ?? ''
		const exists = known.has(id)
		try {
			if (exists && !opts.force) {
				rows.push({ id, name: req.name, outcome: 'skipped', action: 'пропущена: уже есть' })
			} else if (exists) {
				if (!opts.dryRun) await api.update(id, req)
				rows.push({ id, name: req.name, outcome: 'updated', action: opts.dryRun ? 'будет перезаписана' : 'перезаписана' })
			} else {
				if (!opts.dryRun) await api.create(req)
				known.add(id)
				rows.push({ id, name: req.name, outcome: 'created', action: opts.dryRun ? 'будет создана' : 'создана' })
			}
		} catch (e) {
			rows.push({ id, name: req.name, outcome: 'failed', action: `ошибка: ${errMsg(e)}` })
		}
	}
	return rows
}
