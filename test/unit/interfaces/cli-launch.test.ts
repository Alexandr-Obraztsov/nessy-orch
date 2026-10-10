import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isPathArg, resolveDir, terminalUrl } from '../../../src/interfaces/cli/launch'

describe('CLI: запуск приложения в папке', () => {
	it('nessy-orch . и пути — сокращение для app; команды — нет', () => {
		for (const a of ['.', '..', '~', './x', '../x', '~/proj', '/abs/dir']) assert.equal(isPathArg(a), true, a)
		for (const a of ['spawn', 'ls', 'app', 'role', undefined, 'docs']) assert.equal(isPathArg(a), false, String(a))
	})
	it('папка: пусто — текущая, ~ раскрывается, относительные от cwd', () => {
		assert.equal(resolveDir(undefined, '/work/a', '/home/u'), '/work/a')
		assert.equal(resolveDir('.', '/work/a', '/home/u'), '/work/a')
		assert.equal(resolveDir('../b', '/work/a', '/home/u'), '/work/b')
		assert.equal(resolveDir('~', '/work/a', '/home/u'), '/home/u')
		assert.equal(resolveDir('~/proj', '/work/a', '/home/u'), '/home/u/proj')
		assert.equal(resolveDir('/abs', '/work/a', '/home/u'), '/abs')
	})
	it('ссылка: путь кодируется (пробелы, кириллица)', () => {
		assert.equal(terminalUrl('/Users/me/Мой проект'), 'nessy-orch://terminal?dir=%2FUsers%2Fme%2F%D0%9C%D0%BE%D0%B9%20%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82')
		assert.equal(decodeURIComponent(terminalUrl('/a b').split('dir=')[1] ?? ''), '/a b')
	})
})
