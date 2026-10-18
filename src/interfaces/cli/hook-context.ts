/**
 * Контекст, который хук SessionStart отдаёт Claude Code в терминале приложения: первым делом загрузить скилл оркестратора.
 * Хук срабатывает и на startup, и на resume, clear, compact — после сжатия разговора указание возвращается в окно.
 * Текст короткий: тело скилла приходит через инструмент Skill (видно в разговоре, читается свежая версия файла),
 * а здесь только требование загрузить его и главные правила на случай, если загрузка не удалась.
 */

/** Имя скилла плагина для инструмента Skill. */
export const ORCH_SKILL = 'nessy:nessy-orch'

/** Текст additionalContext для сессии оркестратора `sessionId`. */
export function sessionContext(sessionId: string): string {
	return [
		`Это терминал приложения TClaude-Orch, сессия оркестратора ${sessionId} (переменная NESSY_ORCH_SESSION уже задана).`,
		`ВСЕГДА, в каждой сессии этого терминала и до любого ответа (даже уточняющего вопроса), загрузи скилл ${ORCH_SKILL} инструментом Skill и работай по нему. Не полагайся на то, что помнишь его: после сжатия разговора загрузи его снова.`,
		'Если скилл не загрузился: ты оркестратор агентов nessy, сам работу не исполняешь и свои субагенты не используешь;',
		'поручаешь через Bash командами `nessy-orch spawn` и `nessy-orch send` с run_in_background: true, проверяешь отдельным verifier и сводишь ответ.',
	].join('\n')
}

/**
 * Напоминание перед инструментом Agent: в сессии приложения работу делают агенты nessy (её видно во вкладке), а не свои субагенты Claude.
 * `additionalContext` у PreToolUse приходит вместе с результатом, то есть после работы субагента, поэтому напоминание — отказ с причиной:
 * Claude читает её до запуска. Отказывает хук только первому вызову в ходе пользователя, повторный вызов проходит (`agentReminderOutput`).
 */
export function agentReminder(subagentType: string): string {
	const what = subagentType ? `субагента «${subagentType}»` : 'своего субагента'
	return [
		`Напоминание nessy-orch: вместо ${what} поручи эту работу агенту nessy — её увидят во вкладке приложения, а у агента есть GitLab, Jira, Sage и Wiki.`,
		'Запусти в фоне (run_in_background: true): `nessy-orch spawn --role <роль> --name <имя> --title "<3–7 слов>" "<поручение>"`; роли — `nessy-orch role ls`.',
		'Субагент другого скилла (Task, Agent, «dispatch a subagent») в этой сессии тоже означает spawn агента nessy.',
		'Не повторяй вызов: переложи промпт субагента в поручение `spawn`.',
		'Только если пользователь повторно попросил сделать это своими субагентами, повтори вызов (второй раз он пройдёт) и скажи ему, что во вкладке этой работы не будет.',
	].join('\n')
}

/** JSON-ответ PreToolUse: отклонить вызов Agent с напоминанием. */
export function agentReminderOutput(subagentType: string): string {
	return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: agentReminder(subagentType) } })
}

/** JSON-ответ хука SessionStart для Claude Code. */
export function sessionStartOutput(sessionId: string): string {
	return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: sessionContext(sessionId) } })
}

/** Подсказка плейбука в начале хода: одна-две строки; скилл плейбука — `nessy-playbooks:<id>`. */
export function hintContext(skill: string, title: string): string {
	return `Похоже на задачу плейбука «${title}» (накоплен по прошлым сессиям). Если задача та же, загрузи скилл ${skill} инструментом Skill и иди по нему.`
}

/** JSON-ответ хука UserPromptSubmit для Claude Code. */
export function hintOutput(skill: string, title: string): string {
	return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: hintContext(skill, title) } })
}
