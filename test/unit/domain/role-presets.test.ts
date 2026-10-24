import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatRolePreset, parseFrontmatter, parseRolePreset } from '../../../src/domain/role-presets'
import { validateRole } from '../../../src/domain/roles'

const fails = (fn: () => unknown, re: RegExp): void => assert.throws(fn, re)

describe('пресеты ролей: frontmatter', () => {
	it('простые и квотированные значения, комментарии и пустые строки', () => {
		const m = parseFrontmatter('---\nid: reviewer\n# комментарий\n\nname: "Ревьюер: код"\ndescription: \'он сказал "да"\'\ncolor: 210\n---\nТело\n')
		assert.deepEqual(m.fields, { id: 'reviewer', name: 'Ревьюер: код', description: 'он сказал "да"', color: '210' })
		assert.equal(m.body, 'Тело\n')
	})
	it('экранирование в двойных кавычках', () => {
		assert.equal(parseFrontmatter('---\na: "x \\"y\\" \\\\z"\n---\n').fields['a'], 'x "y" \\z')
	})
	it('CRLF и BOM', () => {
		const m = parseFrontmatter('﻿---\r\nid: a\r\nname: B\r\n---\r\nстрока 1\r\nстрока 2\r\n')
		assert.deepEqual(m.fields, { id: 'a', name: 'B' })
		assert.equal(m.body, 'строка 1\nстрока 2\n')
	})
	it('тело сохраняется как есть: --- внутри, отступы, пустые строки', () => {
		const body = '# Заголовок\n\n---\n\n    код\n\n- пункт\n\n'
		assert.equal(parseFrontmatter(`---\nid: a\n---\n${body}`).body, body)
	})
	it('строгость: нет открытия, нет закрытия, мусор, дубликат, незакрытая кавычка', () => {
		fails(() => parseFrontmatter('id: a\n'), /начинаться/)
		fails(() => parseFrontmatter('---\nid: a\n'), /не закрыт/)
		fails(() => parseFrontmatter('---\nпросто текст\n---\n'), /ключ: значение/)
		fails(() => parseFrontmatter('---\nid: a\nid: b\n---\n'), /повторяется/)
		fails(() => parseFrontmatter('---\nname: "abc\n---\n'), /кавычка/)
	})
})

describe('пресеты ролей: поля', () => {
	it('id и name обязательны, color — 0..360', () => {
		fails(() => parseRolePreset('---\nname: A\n---\nx'), /нет id/)
		fails(() => parseRolePreset('---\nid: a\n---\nx'), /нет name/)
		fails(() => parseRolePreset('---\nid: a\nname: A\ncolor: 400\n---\nx'), /0\.\.360/)
		fails(() => parseRolePreset('---\nid: a\nname: A\ncolor: red\n---\nx'), /0\.\.360/)
		const r = parseRolePreset('---\nid: a\nname: A\n---\nx')
		assert.equal(r.color, undefined)
		assert.equal(r.description, '')
	})
	it('round-trip format → parse → validate', () => {
		const role = { id: 'qa-1', name: '"Тестер": #1', description: ' с пробелом ', color: 120, instructions: 'Строка\n\n  отступ\n' }
		const back = parseRolePreset(formatRolePreset(role))
		assert.deepEqual(back, { ...role })
		const v = validateRole(back)
		assert.equal(v.id, 'qa-1')
		assert.equal(v.color, 120)
		assert.equal(v.description, 'с пробелом')
	})
	it('model и runtime: разбор, запись и round-trip; неизвестный рантайм — ошибка', () => {
		const r = parseRolePreset('---\nid: a\nname: A\nmodel: opus\nruntime: tclaude\n---\nx')
		assert.equal(r.model, 'opus')
		assert.equal(r.runtime, 'tclaude')
		const text = formatRolePreset({ id: 'a', name: 'A', description: '', color: 10, model: 'claude-sonnet-4-5', runtime: 'tclaude', instructions: 'x' })
		assert.match(text, /^model: claude-sonnet-4-5$/m)
		assert.match(text, /^runtime: tclaude$/m)
		const back = parseRolePreset(text)
		assert.equal(back.model, 'claude-sonnet-4-5')
		assert.equal(back.runtime, 'tclaude')
		assert.doesNotMatch(formatRolePreset({ id: 'a', name: 'A', description: '', color: 10, model: null, runtime: null, instructions: 'x' }), /model|runtime/)
		fails(() => parseRolePreset('---\nid: a\nname: A\nruntime: bogus\n---\nx'), /runtime/)
	})
})
