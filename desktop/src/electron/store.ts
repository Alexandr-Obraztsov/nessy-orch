/** JSON-файлы в app.getPath('userData'): настройки и состояние окна. Запись — с задержкой и атомарно. */
import * as fs from 'node:fs'
import * as path from 'node:path'

export class JsonFile<T> {
	private timer: NodeJS.Timeout | null = null
	private pendingValue: T | null = null

	constructor(
		private readonly file: string,
		private readonly parse: (raw: unknown) => T,
	) {}

	read(): T {
		let raw: unknown = null
		try {
			raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
		} catch {
			/* файла ещё нет или он испорчен — дефолты */
		}
		return this.parse(raw)
	}

	/** Записать через delayMs (повторные вызовы склеиваются). */
	write(value: T, delayMs = 300): void {
		this.pendingValue = value
		if (this.timer) clearTimeout(this.timer)
		this.timer = setTimeout(() => this.flush(), delayMs)
	}

	/** Записать отложенное сейчас (на выходе). */
	flush(): void {
		if (this.timer) clearTimeout(this.timer)
		this.timer = null
		const v = this.pendingValue
		if (v === null) return
		this.pendingValue = null
		try {
			fs.mkdirSync(path.dirname(this.file), { recursive: true })
			const tmp = `${this.file}.${process.pid}.tmp`
			fs.writeFileSync(tmp, JSON.stringify(v, null, '\t') + '\n')
			fs.renameSync(tmp, this.file)
		} catch (e) {
			console.error('[nessy-desktop] не удалось записать', this.file, e)
		}
	}
}
