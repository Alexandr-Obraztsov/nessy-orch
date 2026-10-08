/** Текстовое представление события чата агента. */
import type { AgentEvent } from '../../../shared/types'
import { bold, dim, green, red, time } from './format'

const indent = (s: string): string =>
	s
		.split('\n')
		.map(l => '    ' + l)
		.join('\n')

export function renderEvent(e: AgentEvent): string {
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
