/** Типы импорта пресетов ролей в CLI. */
import type { RoleRequest, RoleView } from '../../../../shared/types'

/** HTTP-доступ, нужный импорту (в тестах подменяется). */
export interface RolesApi {
	list(): Promise<RoleView[]>
	create(body: RoleRequest): Promise<RoleView>
	update(id: string, body: RoleRequest): Promise<RoleView>
}

export interface ImportOptions {
	force: boolean
	dryRun: boolean
}

export type ImportOutcome = 'created' | 'updated' | 'skipped' | 'invalid' | 'failed'

export interface ImportRow {
	/** id роли (или имя файла, если пресет не разобран) */
	id: string
	name: string
	outcome: ImportOutcome
	/** текст для колонки «действие» */
	action: string
}
