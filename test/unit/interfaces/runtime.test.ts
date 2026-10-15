import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { compareBuild, parseBuild, readVersion, syncRuntime } from '../../../src/interfaces/cli/runtime'

function bundle(root: string, version: string | null, marker = 'x'): string {
	fs.mkdirSync(path.join(root, 'dist', 'src'), { recursive: true })
	fs.mkdirSync(path.join(root, 'bin'), { recursive: true })
	fs.writeFileSync(path.join(root, 'dist', 'src', 'main.js'), `// ${marker}`)
	fs.writeFileSync(path.join(root, 'package.json'), '{}')
	if (version !== null) fs.writeFileSync(path.join(root, 'VERSION'), version + '\n')
	return root
}
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'orch-runtime-'))

describe('рабочая копия сервера для службы', () => {
	it('версии сборки сравниваются по числам', () => {
		assert.deepEqual(parseBuild('1.0.231.2610151700'), [1, 0, 231, 2610151700])
		assert.equal(parseBuild('abc'), null)
		assert.equal(compareBuild('1.0.232.1', '1.0.231.9'), 1)
		assert.equal(compareBuild('1.0.9.1', '1.0.10.1'), -1, 'не по строкам')
		assert.equal(compareBuild('1.0.5.1', '1.0.5.1'), 0)
		assert.equal(compareBuild('1.0.1.1', null), 1)
		assert.equal(compareBuild('мусор', '1.0.1.1'), -1)
	})

	it('новая сборка копируется, такая же или старая — нет (старое приложение новую копию не затирает)', () => {
		const base = tmp()
		const dest = path.join(base, 'runtime')
		const a = bundle(path.join(base, 'a'), '1.0.10.1', 'старая')
		const b = bundle(path.join(base, 'b'), '1.0.11.1', 'новая')
		assert.deepEqual(syncRuntime(a, dest), { root: dest, copied: true }, 'первый раз копируем')
		assert.equal(readVersion(dest), '1.0.10.1')
		assert.deepEqual(syncRuntime(a, dest), { root: dest, copied: false }, 'такая же — ничего не делаем')
		assert.deepEqual(syncRuntime(b, dest), { root: dest, copied: true })
		assert.match(fs.readFileSync(path.join(dest, 'dist', 'src', 'main.js'), 'utf8'), /новая/)
		assert.deepEqual(syncRuntime(a, dest), { root: dest, copied: false }, 'старая версия не откатывает новую')
		assert.match(fs.readFileSync(path.join(dest, 'dist', 'src', 'main.js'), 'utf8'), /новая/)
		assert.ok(!fs.readdirSync(base).some(n => n.includes('.new-') || n.includes('.old-')), 'временных каталогов не остаётся')
		fs.rmSync(base, { recursive: true, force: true })
	})

	it('запуск из исходников (нет VERSION): копии нет, служба смотрит в проект; битая копия восстанавливается', () => {
		const base = tmp()
		const dev = bundle(path.join(base, 'dev'), null)
		assert.deepEqual(syncRuntime(dev, path.join(base, 'runtime')), { root: dev, copied: false })
		const dest = path.join(base, 'runtime')
		const a = bundle(path.join(base, 'a'), '1.0.10.1')
		fs.mkdirSync(dest, { recursive: true })
		fs.writeFileSync(path.join(dest, 'VERSION'), '1.0.99.1\n') // версия есть, а main.js нет: копия повреждена
		assert.equal(syncRuntime(a, dest).copied, true)
		assert.ok(fs.existsSync(path.join(dest, 'dist', 'src', 'main.js')))
		fs.rmSync(base, { recursive: true, force: true })
	})
})
