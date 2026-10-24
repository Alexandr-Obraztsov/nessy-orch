/**
 * Человекочитаемый вывод событий (дизайн AgentPort §8: «человекочитаемые события из SSE»).
 * Отрисовка чистых строк из типа — тестируется без HTTP.
 */
import type { AgentEvent, StreamEvent } from '../../../shared/types'
import { bold, dim, green, red, time } from '../cli/format'

const indent = (s: string): string =>
	s
		.split('\n')
		.map(l => '    ' + l)
		.join('\n')

/** Одно событие агента — компактно и современно (цветной маркер + суть). */
export function renderAgentEvent(e: AgentEvent): string {
	const t = dim(time(e.ts))
	switch (e.kind) {
		case 'user':
			return `${t} ${bold(`← ${e.from}`)}\n${indent(e.text)}`
		case 'text':
			return `${t} ${green('▸')}\n${indent(e.text)}`
		case 'thought':
			return dim(`${time(e.ts)} … ${e.text.replace(/\s+/g, ' ').slice(0, 160)}`)
		case 'tool':
			return `${t} ${bold('⚙ ' + e.name)} ${dim(e.title)} ${dim(`[${e.status}]`)}`
		case 'permission':
			return dim(
				`${time(e.ts)} 🔑 ${e.title} ${e.resolved ? (e.approved ? '— разрешено' + (e.auto ? ' автоматически' : '') : '— отклонено') : '— ждёт решения'}`,
			)
		case 'system':
			return e.level === 'error' ? red(`${time(e.ts)} ! ${e.text}`) : dim(`${time(e.ts)} · ${e.text}`)
	}
}

/** Событие общего потока `/stream` — человеку (snapshot → таблица, message → строка ленты). */
export function renderStreamEvent(ev: StreamEvent): string {
	switch (ev.t) {
		case 'snapshot':
			return dim(`снимок: агентов ${ev.agents.length}, пространств ${ev.spaces.length}, сессий ${ev.sessions.length}, ролей ${ev.roles.length}`)
		case 'message':
			return `${bold(ev.message.from)} ${dim('→')} ${bold(ev.message.to)}${ev.message.kind === 'reply' ? dim(' (ответ)') : ''}${ev.message.failed ? red(` [${ev.message.failed}]`) : ''}  ${dim(ev.message.text.replace(/\s+/g, ' ').slice(0, 80))}`
		case 'agent':
			return `${dim('агент')} ${bold(ev.agent.id)} ${dim(ev.agent.status)}`
		case 'agent_removed':
			return `${dim('агент удалён')} ${bold(ev.id)}`
		case 'space':
			return `${dim('пространство')} ${bold(ev.space.name)} ${dim(ev.space.status)}`
		case 'space_removed':
			return `${dim('пространство удалено')} ${bold(ev.name)}`
		case 'role':
			return `${dim('роль')} ${bold(ev.role.id)} ${dim(ev.role.name)}`
		case 'role_removed':
			return `${dim('роль удалена')} ${bold(ev.id)}`
		case 'session':
			return `${dim('сессия')} ${bold(ev.session.id)} ${dim(ev.session.status)}`
		case 'session_removed':
			return `${dim('сессия удалена')} ${bold(ev.id)}`
	}
}
