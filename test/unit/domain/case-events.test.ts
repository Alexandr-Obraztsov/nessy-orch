import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { condenseReply, renderPortion } from '../../../src/domain/case-events'
import type { RawEvent } from '../../../src/domain/learning.types'

const ev = (n: number, over: Partial<RawEvent> = {}): RawEvent => ({
	n,
	ts: n,
	kind: 'user',
	from: 'user',
	to: 'claude',
	text: `текст ${n}`,
	ref: `r${n}`,
	...over,
})

const at = <T>(a: readonly T[], i: number): T => {
	const v = a[i]
	if (v === undefined) throw new Error(`нет элемента ${i}`)
	return v
}

describe('condenseReply', () => {
	it('остаются Итог, Источники и статус, Детали выброшены', () => {
		const text = ['Вступление', '**Итог**', 'Нашёл 3 файла.', '', '**Детали**', 'длинные детали', 'Статус: DONE — готово', '', '**Источники**', '- a.ts'].join(
			'\n',
		)
		const r = condenseReply(text)
		assert.ok(r.includes('**Итог**') && r.includes('Нашёл 3 файла.'))
		assert.ok(r.includes('- a.ts'))
		assert.ok(r.includes('Статус: DONE — готово'))
		assert.ok(!r.includes('длинные детали') && !r.includes('Вступление'))
	})
	it('без разделов — первые max знаков и многоточие', () => {
		const r = condenseReply('я'.repeat(2000))
		assert.equal(r, `${'я'.repeat(1500)}…`)
		assert.equal(condenseReply('коротко'), 'коротко')
	})
})

describe('renderPortion', () => {
	it('формат строки и границы', () => {
		const p = renderPortion([ev(3), ev(4, { kind: 'task', from: 'claude', to: 'e1' })], 10000)
		assert.equal(p.text, '[3] user user→claude: текст 3\n[4] task claude→e1: текст 4')
		assert.equal(p.from, 3)
		assert.equal(p.until, 4)
	})
	it('лимиты по видам', () => {
		const long = 'x'.repeat(5000)
		const lines = renderPortion(
			[ev(1, { text: long }), ev(2, { kind: 'claude', text: long }), ev(3, { kind: 'task', text: long }), ev(4, { kind: 'call', text: long })],
			100000,
		).text.split('\n')
		assert.equal(at(lines, 0).length, '[1] user user→claude: '.length + 4001)
		assert.equal(at(lines, 1).length, '[2] claude user→claude: '.length + 3001)
		assert.equal(at(lines, 2).length, '[3] task user→claude: '.length + 2001)
		assert.equal(at(lines, 3).length, '[4] call user→claude: '.length + 2001)
	})
	it('reply идёт через condenseReply', () => {
		const text = '**Итог**\nok\n\n**Детали**\nскрыто'
		const p = renderPortion([ev(1, { kind: 'reply', from: 'e1', to: 'claude', text })], 10000)
		assert.ok(p.text.includes('ok') && !p.text.includes('скрыто'))
	})
	it('обрыв до maxChars, но одно событие берётся всегда', () => {
		const events = [ev(1), ev(2), ev(3)]
		const one = renderPortion(events, 5)
		assert.equal(one.from, 1)
		assert.equal(one.until, 1)
		const two = renderPortion(events, '[1] user user→claude: текст 1\n[2] user user→claude: текст 2'.length)
		assert.equal(two.until, 2)
	})
	it('пустой вход', () => {
		assert.deepEqual(renderPortion([], 100), { text: '', from: 0, until: 0 })
	})
	it('skill: строка без маршрута', () => {
		const p = renderPortion([{ n: 4, ts: 0, kind: 'skill', from: 'claude', to: null, text: 'nessy-playbooks:pb-1', ref: 'u' }], 1000)
		assert.equal(p.text, '[4] skill: nessy-playbooks:pb-1')
	})
})
