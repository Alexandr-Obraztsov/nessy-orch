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
	/** резидентная память, МБ (null — неизвестно) */
	rssMb?: number | null
	/** пространство оркестратора с этим воркспейсом */
	space?: string | null
	/** секунд без активности (из /graph; null — неизвестно) */
	idleSec?: number | null
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
	/** ORCH_SERVE_IDLE_MIN: простой serve до остановки, мин (0 — не останавливать) */
	serveIdleMin: number
	/** ORCH_MAX_SERVES: лимит одновременно запущенных serve (0 — без лимита) */
	maxServes: number
	spaces: DoctorSpace[]
	hints: string[]
}
