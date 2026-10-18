import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ORCH_SKILL, agentReminder, agentReminderOutput, sessionContext, sessionStartOutput } from '../../../src/interfaces/cli/hook-context'

describe('хук PreToolUse на Agent: напоминание про агентов nessy', () => {
	it('отказ с причиной: как запустить агента nessy и что повтор пройдёт', () => {
		const j = JSON.parse(agentReminderOutput('Explore')) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } }
		assert.equal(j.hookSpecificOutput.hookEventName, 'PreToolUse')
		assert.equal(j.hookSpecificOutput.permissionDecision, 'deny')
		const r = j.hookSpecificOutput.permissionDecisionReason
		assert.match(r, /«Explore»/)
		assert.match(r, /nessy-orch spawn --role/)
		assert.match(r, /run_in_background: true/)
		assert.match(r, /Не повторяй вызов: переложи промпт субагента в поручение `spawn`/)
		assert.match(r, /Только если пользователь повторно попросил .* повтори вызов/)
	})
	it('без типа субагента — общая формулировка', () => {
		assert.match(agentReminder(''), /своего субагента/)
	})
})

describe('хук SessionStart: указание загрузить скилл оркестратора', () => {
	it('контекст называет сессию и скилл, требует загрузить его до ответа и после сжатия', () => {
		const c = sessionContext('s-123')
		assert.match(c, /s-123/)
		assert.ok(c.includes(`загрузи скилл ${ORCH_SKILL} инструментом Skill`))
		assert.match(c, /ВСЕГДА, в каждой сессии/)
		assert.match(c, /до любого ответа/)
		assert.match(c, /после сжатия разговора загрузи его снова/)
		assert.ok(c.length < 1500, 'указание короткое: тело скилла приходит через Skill')
	})
	it('вывод — JSON формата Claude Code для SessionStart', () => {
		const j = JSON.parse(sessionStartOutput('s-1')) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }
		assert.equal(j.hookSpecificOutput.hookEventName, 'SessionStart')
		assert.equal(j.hookSpecificOutput.additionalContext, sessionContext('s-1'))
	})
})
