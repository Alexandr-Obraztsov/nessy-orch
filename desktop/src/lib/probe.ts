/** Кто слушает порт оркестратора: никто, наш nessy-orch или чужой процесс. */
import type { ProbeRaw, ProbeResult } from '../types'

const FREE_CODES = new Set(['ECONNREFUSED', 'EADDRNOTAVAIL'])

export function classifyProbe(r: ProbeRaw): ProbeResult {
	if (r.errorCode !== null) {
		if (FREE_CODES.has(r.errorCode)) return { kind: 'free' }
		return { kind: 'foreign', detail: `порт не отвечает как nessy-orch (${r.errorCode})` }
	}
	if (r.statusCode === 200) {
		let body: unknown
		try {
			body = JSON.parse(r.body)
		} catch {
			body = null
		}
		if (typeof body === 'object' && body !== null) {
			const o = body as Record<string, unknown>
			const version = o['version']
			const pid = o['pid']
			if (typeof version === 'string' && typeof pid === 'number' && typeof o['rev'] === 'number' && typeof o['home'] === 'string')
				return { kind: 'ours', version, pid }
		}
	}
	const snippet = r.body.replace(/\s+/g, ' ').trim().slice(0, 80)
	return { kind: 'foreign', detail: `на порту другой сервер (HTTP ${r.statusCode ?? '?'}${snippet ? `: ${snippet}` : ''})` }
}
