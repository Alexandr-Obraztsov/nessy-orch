import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AppError } from '../../../src/domain/errors'
import { parseBatchSpecs, parseBatchText } from '../../../src/domain/spawn-batch'

describe('пакет агентов из текста', () => {
	it('блоки «@@ имя role=…» с многострочными поручениями без экранирования', () => {
		const list = parseBatchText(`@@ explorer role=code-explorer space=/tmp/x
Цель: найти "refund" в репозитории
Контекст: ветка main --- не путать с разделителем

@@ verifier role=verifier session=s1
Проверь результат explorer
@@ bare`)
		assert.deepEqual(list, [
			{ name: 'explorer', role: 'code-explorer', space: '/tmp/x', prompt: 'Цель: найти "refund" в репозитории\nКонтекст: ветка main --- не путать с разделителем' },
			{ name: 'verifier', role: 'verifier', session: 's1', prompt: 'Проверь результат explorer' },
			{ name: 'bare' },
		])
	})
	it('JSON-массив тоже принимается', () => {
		assert.deepEqual(parseBatchText('[{"name":"a","role":"r","prompt":"p"},{"prompt":"без имени"}]'), [
			{ name: 'a', role: 'r', space: undefined, session: undefined, prompt: 'p' },
			{ name: undefined, role: undefined, space: undefined, session: undefined, prompt: 'без имени' },
		])
	})
	it('ошибки: пусто, текст до заголовка, неизвестный ключ, битый JSON', () => {
		const bad = (e: unknown): boolean => e instanceof AppError && e.status === 400
		assert.throws(() => parseBatchText('  \n'), bad)
		assert.throws(() => parseBatchText('просто текст\n@@ a'), bad)
		assert.throws(() => parseBatchText('@@ a color=red\nx'), bad)
		assert.throws(() => parseBatchText('@@ a role=\nx'), bad)
		assert.throws(() => parseBatchText('[{"name":'), bad)
		assert.throws(() => parseBatchText('[]'), bad)
	})
})

describe('пакет агентов из позиционных аргументов (без heredoc)', () => {
	it('«имя|роль|поручение»: пустые имя и роль, «|» внутри поручения', () => {
		assert.deepEqual(parseBatchSpecs(['ci|executor|Починить тест', '|verifier|Проверить', 'x||одна | из | строк', 'y|-|без роли']), [
			{ name: 'ci', role: 'executor', prompt: 'Починить тест' },
			{ role: 'verifier', prompt: 'Проверить' },
			{ name: 'x', prompt: 'одна | из | строк' },
			{ name: 'y', prompt: 'без роли' },
		])
	})
	it('ошибки: нет разделителей, пустое поручение, пустой список', () => {
		assert.throws(() => parseBatchSpecs(['просто текст']), /формат «имя\|роль\|поручение»/)
		assert.throws(() => parseBatchSpecs(['a|b|  ']), /пустое поручение/)
		assert.throws(() => parseBatchSpecs([]), /нет агентов/)
	})
})
