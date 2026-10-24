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

/** Последние `maxLines` непустых строк файла: читает блоками с конца, не весь файл. Второй элемент — дошли ли до начала файла. */
export function readTailLines(file: string, maxLines: number): { lines: string[]; complete: boolean } {
	let fd: number
	try {
		fd = fs.openSync(file, 'r')
	} catch {
		return { lines: [], complete: true }
	}
	try {
		const size = fs.fstatSync(fd).size
		const block = 64 * 1024
		let pos = size
		let chunks: Buffer[] = []
		let newlines = 0
		// нужно maxLines + 1 переводов строки, чтобы первая строка среза была целой
		while (pos > 0 && newlines <= maxLines) {
			const len = Math.min(block, pos)
			pos -= len
			const buf = Buffer.alloc(len)
			fs.readSync(fd, buf, 0, len, pos)
			for (const b of buf) if (b === 0x0a) newlines++
			chunks = [buf, ...chunks]
		}
		let lines = Buffer.concat(chunks).toString('utf8').split('\n')
		// без начала файла первая строка может быть оборвана
		if (pos > 0) lines = lines.slice(1)
		lines = lines.filter(Boolean)
		return { lines: lines.slice(-maxLines), complete: pos === 0 && lines.length <= maxLines }
	} finally {
		fs.closeSync(fd)
	}
}

export function appendJsonl(file: string, value: unknown): void {
	const isNew = !fs.existsSync(file)
	fs.appendFileSync(file, JSON.stringify(value) + '\n')
	// секреты в покое: новый файл ограничиваем только владельцем (§3 «секреты в покое»)
	if (isNew) fs.chmodSync(file, 0o600)
}

/** Атомарная запись: tmp + rename. Файл пишется с правами 0o600 — секреты в покое (§3). */
export function writeAtomic(file: string, text: string): void {
	const tmp = file + '.tmp'
	fs.writeFileSync(tmp, text, { mode: 0o600 })
	fs.renameSync(tmp, file)
}
