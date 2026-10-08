import type { AgentView } from '@contract'
import type { ComposerHint } from '../model/types'

/**
 * Что случится при отправке сообщения этому агенту (сервер прерывает ход по умолчанию).
 * interrupt — состояние галочки «прервать текущий ход» (undefined — галочки нет).
 */
export function composerHint(agent: AgentView | null, interrupt?: boolean): ComposerHint | null {
	if (!agent) return null
	const busy = agent.status === 'working' || agent.status === 'starting'
	if (busy && interrupt === false) return { tone: 'info', text: 'Сообщение встанет в очередь — агент прочтёт его после текущего хода' }
	if (busy && interrupt === true) return null
	if (agent.archived) return { tone: 'info', text: 'Агент в архиве — проснётся с прежним контекстом' }
	if (agent.status === 'working') return { tone: 'warn', text: 'Агент работает — сообщение прервёт текущий ход' }
	if (agent.status === 'error') return { tone: 'info', text: 'Последний ход завершился ошибкой — агент начнёт заново' }
	return null
}

const short = (n: string): string => (n.length > 24 ? `${n.slice(0, 22)}…` : n)

/** Плейсхолдер поля ввода под состояние адресата; fixed — адресат задан (детали агента). */
export function composerPlaceholder(agent: AgentView | null, fixed = false): string {
	if (!agent) return 'Сообщение…'
	const name = short(agent.name)
	if (fixed) return `Написать ${name}…`
	if (agent.archived) return `Написать ${name} — проснётся…`
	if (agent.status === 'working') return `Написать ${name} — прервёт текущий ход…`
	return `Сообщение для ${name}…`
}
