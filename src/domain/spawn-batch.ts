/**
 * Разбор пакета агентов из текста (CLI `spawn-many`). Формат без экранирования — удобен для длинных поручений:
 *
 *   @@ имя role=роль space=путь
 *   Цель: …            ← всё до следующей строки «@@» — поручение
 *   @@ другой-агент role=verifier
 *   …
 *
 * Ключи после имени необязательны: role, space, session. Либо JSON-массив объектов SpawnRequest.
 */
import type { SpawnRequest } from '../../shared/types'
import { isObject } from '../lib/json'
import { AppError } from './errors'

const HEADER_RE = /^@@\s+(\S+)((?:\s+[a-z]+=\S+)*)\s*$/
const KEYS = ['role', 'space', 'session'] as const

const bad = (msg: string): AppError => new AppError(400, 'bad_request', msg)

export function parseBatchText(text: string): SpawnRequest[] {
	const trimmed = text.trim()
	if (!trimmed) throw bad('пакет пуст: ожидаются блоки «@@ имя role=…» или JSON-массив')
	if (trimmed.startsWith('[')) return parseBatchJson(trimmed)

	const out: SpawnRequest[] = []
	let cur: { req: SpawnRequest; lines: string[] } | null = null
	const flush = (): void => {
		if (!cur) return
		const prompt = cur.lines.join('\n').trim()
		if (prompt) cur.req.prompt = prompt
		out.push(cur.req)
	}
	for (const [i, line] of text.replace(/\r\n/g, '\n').split('\n').entries()) {
		if (line.startsWith('@@')) {
			const m = HEADER_RE.exec(line.trimEnd())
			if (!m) throw bad(`строка ${i + 1}: заголовок должен быть «@@ имя [role=…] [space=…] [session=…]»`)
			flush()
			const req: SpawnRequest = { name: m[1] }
			for (const kv of (m[2] ?? '').trim().split(/\s+/).filter(Boolean)) {
				const [k, ...v] = kv.split('=')
				if (!(KEYS as readonly string[]).includes(k ?? '')) throw bad(`строка ${i + 1}: неизвестный ключ «${k ?? ''}» (role, space, session)`)
				req[k as (typeof KEYS)[number]] = v.join('=')
			}
			cur = { req, lines: [] }
		} else if (cur) cur.lines.push(line)
		else if (line.trim()) throw bad(`строка ${i + 1}: текст до первого заголовка «@@ имя …»`)
	}
	flush()
	if (!out.length) throw bad('в пакете нет ни одного блока «@@ имя …»')
	return out
}

/**
 * Пакет из позиционных аргументов без heredoc и файлов (в песочнице heredoc не работает): каждый аргумент — «имя|роль|поручение».
 * Имя и роль можно оставить пустыми («|executor|…», «имя||…»); «|» в самом поручении допустим — делится только по первым двум.
 */
export function parseBatchSpecs(specs: readonly string[]): SpawnRequest[] {
	if (!specs.length) throw bad('нет агентов: ожидаются аргументы «имя|роль|поручение»')
	return specs.map((spec, i) => {
		const first = spec.indexOf('|')
		const second = first < 0 ? -1 : spec.indexOf('|', first + 1)
		if (second < 0) throw bad(`аргумент ${i + 1}: формат «имя|роль|поручение» (два символа «|»), получено: ${spec.slice(0, 60)}`)
		const name = spec.slice(0, first).trim()
		const role = spec.slice(first + 1, second).trim()
		const prompt = spec.slice(second + 1).trim()
		if (!prompt) throw bad(`аргумент ${i + 1}: пустое поручение`)
		const req: SpawnRequest = { prompt }
		if (name) req.name = name
		if (role && role !== '-') req.role = role
		return req
	})
}

function parseBatchJson(text: string): SpawnRequest[] {
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch {
		throw bad('не удалось разобрать JSON-массив агентов')
	}
	if (!Array.isArray(raw) || !raw.length) throw bad('JSON должен быть непустым массивом объектов')
	return raw.map((o: unknown, i) => {
		if (!isObject(o)) throw bad(`элемент ${i + 1}: ожидается объект`)
		const str = (k: string): string | undefined => (typeof o[k] === 'string' && o[k] !== '' ? o[k] : undefined)
		return { name: str('name'), role: str('role'), space: str('space'), session: str('session'), prompt: str('prompt') }
	})
}
