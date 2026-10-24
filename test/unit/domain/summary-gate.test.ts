/** Проверки описания блока (R1–R10, F1, F2): по тесту на каждое правило; R4/R6/R7 и мягкий R10 — предупреждения. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { RawEvent } from '../../../shared/types'
import { goalsOf, parseBrief } from '../../../src/domain/brief'
import { appendToSection, applyLadder, autoDescription, blockFacts, checkBlock, checkFinal, correctionEvents, findAnchors, formatRejection, waiveSkipped } from '../../../src/domain/summary-gate'

const ev = (n: number, text: string, kind: RawEvent['kind'] = 'task'): RawEvent => ({ n, ts: 0, kind, from: 'you', to: 'a1', text, ref: `r${n}` })

/** Валидное описание для событий 11–16 (по пункту на событие). */
const FACTS = 'See PROJ-12 and MR !456, src/app/main.ts, https://git.example.com/x/y, build 12345'
const events = [ev(11, FACTS), ev(12, 'second step'), ev(13, 'third step'), ev(14, 'fourth step'), ev(15, 'fifth step'), ev(16, 'sixth step')]
const goal = (sections: Partial<Record<string, string[]>> = {}): string => {
	const s: Record<string, string[]> = {
		Plan: ['- plan the work'],
		Actions: [
			'- inspected PROJ-12 and MR !456 in src/app/main.ts, build 12345 (n 11)',
			'- opened https://git.example.com/x/y -> agent -> read (n 12)',
			'- third step done (n 13)',
			'- fourth step done (n 14)',
			'- fifth step done (n 15)',
			'- sixth step done (n 16)',
		],
		Sources: ['- none'],
		'User corrections': ['- none'],
		'Open questions': ['- none'],
		Skipped: ['- none'],
		...sections,
	}
	return ['# Title', '## Goal: do it (type: do task)', ...Object.entries(s).flatMap(([k, v]) => [`### ${k}`, ...v])].join('\n')
}
const base = { prev: '# old', events, from: 11, until: 16 }
const issues = (text: string, over: Partial<typeof base> = {}): string[] => checkBlock({ ...base, ...over, text }).map(i => `${i.code}: ${i.text}`)
const codes = (text: string, over: Partial<typeof base> = {}): string[] => checkBlock({ ...base, ...over, text }).map(i => i.code)
/** нарушения, из-за которых описание отклоняется (без предупреждений) */
const hard = (text: string, over: Partial<typeof base> = {}): string[] => applyLadder(checkBlock({ ...base, ...over, text }), 0).hard.map(i => i.code)
const brief = ['## Brief', 'gist: the task was done and accepted.', 'entities: PROJ-12, src/app/main.ts', 'skeleton:', '1. inspect', '2. fix', '3. verify'].join('\n')

describe('summary-gate', () => {
	it('валидное описание проходит все правила', () => {
		assert.deepEqual(issues(goal()), [])
	})

	it('R1: якорь вне [1, until] и перепутанные границы — отказ с диапазоном', () => {
		const bad = goal({ Actions: ['- invented (n 40–99)', '- backwards (n 15–12)', '- real (n 11–16)'] })
		const r = issues(bad).filter(i => i.startsWith('R1'))
		assert.equal(r.length, 1)
		assert.match(r[0] ?? '', /n 40–99 \(outside n 1–16\)/)
		assert.match(r[0] ?? '', /n 15–12 \(malformed range\)/)
		assert.ok(!codes(goal()).includes('R1'))
		assert.deepEqual(findAnchors('x n 5, n 7–9, n 3-4'.replace('x ', '')).map(a => [a.from, a.to]), [[5, 5], [7, 9], [3, 4]])
	})

	it('R2: событие без якоря и без ### Skipped — отказ с номерами; пропуск с причиной ≥ 3 слов закрывает событие', () => {
		const missing = goal({ Actions: ['- facts PROJ-12 MR !456 src/app/main.ts https://git.example.com/x/y 12345 (n 11–13)', '- later (n 14)', '- later (n 15)'] })
		const r = issues(missing).find(i => i.startsWith('R2'))
		assert.match(r ?? '', /R2: coverage: events n 16 /)
		const skipped = goal({ Actions: ['- facts PROJ-12 MR !456 src/app/main.ts https://git.example.com/x/y 12345 (n 11–13)', '- later (n 14)', '- later (n 15)'], Skipped: ['- n 16 — pure acknowledgement without content'] })
		assert.ok(!codes(skipped).includes('R2'))
		const shortReason = goal({ Skipped: ['- n 16 — noise'] })
		assert.match(issues(shortReason).find(i => i.startsWith('R2')) ?? '', /reason too short.*n 16/)
	})

	it('R3: то же описание или нет якоря внутри блока — отказ', () => {
		const same = goal()
		assert.match(issues(same, { prev: same }).join('|'), /R3: progress: the description is identical/)
		const old = goal({ Actions: ['- facts PROJ-12 MR !456 src/app/main.ts https://git.example.com/x/y 12345 (n 1–3)'] })
		assert.match(issues(old).join('|'), /R3: progress: no anchor inside the current block \(n 11–16\)/)
		assert.ok(!codes(goal()).includes('R3'))
	})

	it('R4: якорных пунктов меньше ⌈событий/6⌉ — отказ', () => {
		const many = Array.from({ length: 12 }, (_, i) => ev(21 + i, `step ${i}`))
		const one = goal({ Actions: ['- all twelve (n 21–32)'] })
		const r = issues(one, { events: many, from: 21, until: 32 }).find(i => i.startsWith('R4'))
		assert.match(r ?? '', /R4: density: 1 anchored items .* n 21–32.* need at least 2/)
		const two = goal({ Actions: ['- first half (n 21–26)', '- second half (n 27–32)'] })
		assert.ok(!codes(two, { events: many, from: 21, until: 32 }).includes('R4'))
		// плотность — предупреждение, не отказ
		assert.deepEqual(hard(one, { events: many, from: 21, until: 32 }), [])
	})

	it('R5: общие фразы — отказ (английский и русский)', () => {
		assert.match(issues(goal({ Plan: ['- The text discusses the migration'] })).join('|'), /R5: filler: "The text discusses"/)
		assert.match(issues(goal({ Plan: ['- В тексте обсуждается миграция'] })).join('|'), /R5: filler/)
		assert.ok(!codes(goal()).includes('R5'))
	})

	it('R6: идентификаторы блока (тикет, MR, URL, путь, число ≥ 3 цифр) должны быть в тексте; пропущенные перечисляются', () => {
		assert.deepEqual(blockFacts([events[0] as RawEvent]).sort(), ['!456', '12345', 'PROJ-12', 'https://git.example.com/x/y', 'src/app/main.ts'].sort())
		const lost = goal({ Actions: ['- inspected things (n 11)', '- second (n 12)', '- third step (n 13–16)'] })
		const r = issues(lost).find(i => i.startsWith('R6'))
		assert.match(r ?? '', /PROJ-12/)
		assert.match(r ?? '', /!456/)
		assert.match(r ?? '', /12345/)
		assert.match(r ?? '', /src\/app\/main\.ts/)
		// якорь с номером события не заменяет число из блока
		const e = [ev(300, 'value 300 in config')]
		assert.match(issues(goal({ Actions: ['- changed value (n 300)'] }), { events: e, from: 300, until: 300 }).join('|'), /R6: .*300/)
		assert.ok(!codes(goal({ Actions: ['- changed value 300 (n 300)'] }), { events: e, from: 300, until: 300 }).includes('R6'))
		assert.ok(!codes(goal()).includes('R6'))
		assert.ok(!hard(lost).includes('R6')) // предупреждение
	})

	it('R7: поправка пользователя без цитаты с якорем — отказ; цитата ≤ 25 слов принимается', () => {
		const withUser = [...events.slice(0, 5), ev(16, 'No, do it instead via the API', 'user')]
		assert.deepEqual(correctionEvents(withUser).map(e => e.n), [16])
		const r = issues(goal(), { events: withUser }).find(i => i.startsWith('R7'))
		assert.match(r ?? '', /R7: corrections: user events n 16 /)
		const ok = goal({ 'User corrections': ['- Proposed: direct call. User: "do it instead via the API" (n 16)'] })
		assert.ok(!codes(ok, { events: withUser }).includes('R7'))
		const long = goal({ 'User corrections': [`- User: "${'word '.repeat(30).trim()}" (n 16)`] })
		assert.match(issues(long, { events: withUser }).find(i => i.startsWith('R7')) ?? '', /quote for n 16 is longer than 25 words/)
		assert.ok(!hard(goal(), { events: withUser }).includes('R7')) // предупреждение
		// русские маркеры
		assert.equal(correctionEvents([ev(1, 'Нет, сделай вместо этого иначе', 'user'), ev(2, 'спасибо', 'user'), ev(3, 'исправь тут', 'claude')]).length, 1)
	})

	it('R8: строка с 200+ знаками текста блока — отказ', () => {
		const long = 'alpha beta gamma delta '.repeat(20).trim()
		const e = [ev(11, long), ev(12, 'x'), ev(13, 'x'), ev(14, 'x'), ev(15, 'x'), ev(16, 'x')]
		const copied = goal({ Actions: [`- ${long} (n 11)`, '- x (n 12–16)'] })
		assert.match(issues(copied, { events: e }).find(i => i.startsWith('R8')) ?? '', /R8: copying/)
		const retold = goal({ Actions: ['- alpha beta gamma delta repeated twenty times (n 11)', '- x (n 12–16)'] })
		assert.ok(!codes(retold, { events: e }).includes('R8'))
	})

	it('R9: структура — заголовок, цель с (type: …), все шесть разделов непустые', () => {
		assert.match(issues('no heading\n## Goal: g (type: t)').join('|'), /R9: structure: the first line must be/)
		assert.match(issues(goal().replace('(type: do task)', '')).join('|'), /R9: structure: .*has no "\(type:/)
		const missing = goal().replace('### Skipped\n- none', '')
		assert.match(issues(missing).find(i => i.startsWith('R9')) ?? '', /missing ### Skipped/)
		const empty = goal({ 'Open questions': [] })
		assert.match(issues(empty).find(i => i.startsWith('R9')) ?? '', /empty ### Open questions/)
		assert.match(issues('# T\nтекст').join('|'), /no "## Goal:/)
		assert.ok(!codes(goal()).includes('R9'))
	})

	it('R9: раздел Brief и порядок разделов v2 не мешают структуре', () => {
		const v2 = [goal({}), brief].join('\n')
		assert.deepEqual(issues(v2), [])
	})

	it('R10: > 12 000 знаков — предупреждение, > 20 000 — отказ; пункт Actions > 200 знаков — предупреждение', () => {
		const pad = (n: number): string => goal({ Plan: ['- ' + 'a'.repeat(n)] })
		assert.deepEqual(checkBlock({ ...base, text: pad(13000) }).filter(i => i.code === 'R10').map(i => i.soft), [true])
		assert.ok(!hard(pad(13000)).includes('R10'))
		assert.ok(hard(pad(21000)).includes('R10'))
		assert.ok(!codes(goal()).includes('R10'))
		const longItem = goal({ Actions: [`- ${'long '.repeat(45)}(n 11–16) PROJ-12 !456 src/app/main.ts https://git.example.com/x/y 12345`] })
		const r = checkBlock({ ...base, text: longItem }).find(i => i.code === 'R10') as { soft?: boolean; text: string }
		assert.equal(r.soft, true)
		assert.match(r.text, /Actions item\(s\) longer than 200/)
	})

	it('F2: --final без корректного Brief отклоняется (нет раздела, нет поля, entities > 12, skeleton > 6)', () => {
		const prev = goal()
		const f2 = (text: string): string | undefined => checkFinal({ text, prev, until: 16 }).find(i => i.code === 'F2')?.text
		assert.match(f2(prev) ?? '', /no "## Brief" section/)
		assert.match(f2([prev, '## Brief', 'gist: x', 'entities: A'].join('\n')) ?? '', /all three fields/)
		const many = Array.from({ length: 13 }, (_, i) => `E-${i}`).join(', ')
		assert.match(f2([prev, '## Brief', 'gist: x', `entities: ${many}`, 'skeleton:', '1. a'].join('\n')) ?? '', /entities has 13 items/)
		const steps = Array.from({ length: 7 }, (_, i) => `${i + 1}. s${i}`)
		assert.match(f2([prev, '## Brief', 'gist: x', 'entities: A', 'skeleton:', ...steps].join('\n')) ?? '', /skeleton has 7 steps/)
		assert.equal(f2([prev, brief].join('\n')), undefined)
		assert.deepEqual(checkFinal({ text: [prev, brief].join('\n'), prev, until: 16 }), [])
	})

	it('Brief: parseBrief и goalsOf читают описание v2', () => {
		const text = [goal(), brief].join('\n')
		assert.deepEqual(parseBrief(text), { gist: 'the task was done and accepted.', entities: ['PROJ-12', 'src/app/main.ts'], skeleton: ['inspect', 'fix', 'verify'] })
		assert.deepEqual(goalsOf(text), [{ title: 'do it', type: 'do task', plan: 'plan the work' }])
	})

	it('отказ перечисляет все нарушения сразу в заданном формате', () => {
		const msg = formatRejection(checkBlock({ ...base, text: '# x\nThe text discusses things' }), 2, 3)
		assert.match(msg, /^REJECTED \(attempt 2\/3\): R\d: /)
		assert.match(msg, /R2: /)
		assert.match(msg, /R5: /)
		assert.match(msg, /R9: /)
		assert.match(msg, /Fix only the listed items\. Do not resubmit until all checks pass\.$/)
	})

	it('--final: структура и якоря; сохранение ≥ 90 % якорей прежнего описания', () => {
		const prev = goal()
		const fin = (text: string): ReturnType<typeof checkFinal> => checkFinal({ text: `${text}\n${brief}`, prev, until: 16 })
		assert.deepEqual(fin(prev), [])
		const merged = goal({ Actions: ['- inspected PROJ-12 (n 11)', '- opened link (n 12)', '- third to sixth steps (n 13)', '- (n 14)', '- (n 15)', '- (n 16)'] })
		assert.deepEqual(fin(merged), [])
		const lost = goal({ Actions: ['- all (n 11)'] })
		const r = fin(lost)
		assert.equal(r[0]?.code, 'F1')
		assert.match(r[0].text, /only 1 of 6 anchors/)
		assert.ok(fin('# T').some(i => i.code === 'R9'))
		assert.ok(fin(goal({ Plan: ['- see (n 99)'] })).some(i => i.code === 'R1'))
	})

	it('R7: слабые маркеры (should, rather, нет, надо, лучше) поправкой не считаются', () => {
		assert.equal(correctionEvents([ev(1, 'It should return a list', 'user'), ev(2, 'rather long text', 'user'), ev(3, 'нет вопросов, надо делать, лучше так', 'user')]).length, 0)
		assert.equal(correctionEvents([ev(1, "don't touch that", 'user'), ev(2, 'This is wrong', 'user'), ev(3, 'Actually, use B', 'user'), ev(4, 'сделай а не это', 'user')]).length, 4)
	})

	it('лестница: 0 — R4/R6/R7 предупреждения; 1 — ещё R5/R8 сняты; ≥ 2 — жёсткие только R1/R3/R9 (итог: R1/R9)', () => {
		const all = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'F1', 'F2'].map(code => ({ code, text: code, soft: ['R4', 'R6', 'R7'].includes(code) }))
		const h = (f: number, final = false): string => applyLadder(all, f, final).hard.map(i => i.code).join()
		assert.equal(h(0), 'R1,R2,R3,R5,R8,R9,R10,F1,F2')
		assert.equal(applyLadder(all, 0).warnings.map(i => i.code).join(), 'R4,R6,R7')
		assert.equal(h(1), 'R1,R2,R3,R9,R10,F2')
		assert.equal(h(2), 'R1,R3,R9')
		assert.equal(h(5), 'R1,R3,R9')
		assert.equal(h(2, true), 'R1,R9')
	})

	it('waiveSkipped дописывает непокрытые события в ### Skipped с пометкой; appendToSection убирает - none', () => {
		const text = goal({ Actions: ['- facts PROJ-12 (n 11)', '- x (n 14)'] })
		const out = waiveSkipped(text, events)
		assert.match(out, /### Skipped\n- n 12–13 — not summarized \(gate waived after repeated rejections\)\n- n 15–16 — not summarized/)
		assert.ok(!/### Skipped\n- none/.test(out))
		assert.equal(waiveSkipped(goal(), events), goal())
		assert.equal(appendToSection('# T\n### Plan\n- none\n### B\n- y', 'Plan', ['- z']), '# T\n### Plan\n- z\n### B\n- y')
	})

	it('autoDescription: по пункту (auto) с якорем на событие; проходит R1 и R9 даже на мусоре; якоря «n 5» из текста не размножаются', () => {
		const evs = [ev(11, 'see n 500 and more text'), ev(12, 'b')]
		const out = autoDescription('', evs)
		assert.match(out, /- \(auto\) \[11\] task you→a1: see n\. 500 and more text \(n 11\)/)
		assert.deepEqual(checkFinal({ text: `${out}\n${brief}`, prev: '', until: 12 }), [])
		const again = autoDescription(out, [ev(13, 'c')])
		assert.match(again, /\(n 13\)/)
		assert.deepEqual(checkFinal({ text: `${again}\n${brief}`, prev: out, until: 13 }), [])
	})
})
