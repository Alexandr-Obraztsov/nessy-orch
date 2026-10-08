import type { StatusResponse } from '../../../../shared/types'
import type { ProcessInfo, ServePidRecord } from '../../../infrastructure/process/process.types'

/**
 * Чей процесс nessy serve:
 *   owned   — дочерний процесс живого оркестратора;
 *   orphan  — от оркестратора, но тот умер или это другой экземпляр (ppid=1, pid записан, родитель — оркестратор);
 *   foreign — запущен не оркестратором (например, вручную) — doctor --fix его не трогает.
 */
export type ServeOwnership = 'owned' | 'orphan' | 'foreign'

export interface DoctorServe extends ProcessInfo {
	owner: ServeOwnership
}

export interface DoctorRecord extends ServePidRecord {
	alive: boolean
}

export interface DoctorSpace {
	name: string
	active: number
	archived: number
}

export interface DoctorReport {
	home: string
	port: number
	/** null — оркестратор недоступен */
	status: StatusResponse | null
	lock: { file: string; pid: number | null; alive: boolean }
	/** pid живого оркестратора (из /status или из lock) */
	ownerPid: number | null
	orchestrators: ProcessInfo[]
	records: DoctorRecord[]
	serves: DoctorServe[]
	maxSessions: number
	spaces: DoctorSpace[]
	hints: string[]
}
