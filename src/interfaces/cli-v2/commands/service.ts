/**
 * Команда status cli-v2: состояние оркестратора (компактно, цветом).
 */
import type { StatusResponse } from '../../../../shared/types'
import { flagBool } from '../../cli/args'
import { green } from '../../cli/format'
import type { Ctx } from '../ctx'
import { COMMON } from '../flags'
import type { CommandTable } from './command.types'

async function cmdStatus(c: Ctx): Promise<void> {
	const { p, t } = c
	const s = await t.get<StatusResponse>('/status')
	if (flagBool(p, 'json')) return c.json(s)
	c.out(`${green('●')} nessy-orch ${s.version}  pid ${s.pid}  uptime ${s.uptimeSec}с`)
	c.out(`  пространств: ${s.spaces}   агентов: ${s.agents} (работают: ${s.working})   ролей: ${s.roles}   автоподтверждение: ${s.autoApprove ? 'вкл' : 'выкл'}`)
}

export const serviceCommands: CommandTable = {
	status: { run: cmdStatus, spec: COMMON },
}
