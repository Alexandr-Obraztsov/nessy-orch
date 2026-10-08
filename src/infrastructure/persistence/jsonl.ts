/** Файловые примитивы хранилища: чтение текста, JSONL, атомарная запись. */
import * as fs from 'node:fs'
import { isObject, parseJson } from '../../lib/json'

export function readText(file: string): string {
	try {
		return fs.readFileSync(file, 'utf8')
	} catch {
		return ''
	}
}

/** Последние `limit` объектов JSONL; битые строки (обрыв записи) пропускаются. */
export function readJsonl<T>(file: string, limit: number): T[] {
	const lines = readText(file).split('\n').filter(Boolean)
	const out: T[] = []
	for (const l of lines.slice(-limit)) {
		const v = parseJson(l)
		if (isObject(v)) out.push(v as T)
	}
	return out
}

export function appendJsonl(file: string, value: unknown): void {
	fs.appendFileSync(file, JSON.stringify(value) + '\n')
}

/** Атомарная запись: tmp + rename. */
export function writeAtomic(file: string, text: string): void {
	const tmp = file + '.tmp'
	fs.writeFileSync(tmp, text)
	fs.renameSync(tmp, file)
}
