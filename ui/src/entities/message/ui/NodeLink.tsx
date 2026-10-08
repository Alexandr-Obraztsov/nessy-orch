import { YOU, nodeLabel, openAgent, useStore } from '@/shared/model'
import type { NodeLinkProps } from '../model/types'
import s from './NodeLink.module.css'

/** Имя узла: «Вы», «система» или кликабельное имя агента (открывает его вкладку). */
export function NodeLink({ id, strong }: NodeLinkProps) {
	const exists = useStore(st => st.agents.some(a => a.id === id))
	const label = useStore(st => nodeLabel(st.agents, id))
	const cls = (...extra: (string | false | undefined)[]): string => [s.name, strong && s.strong, ...extra].filter(Boolean).join(' ')
	if (id === YOU) return <span className={cls(s.you)}>Вы</span>
	if (!exists) return <span className={cls(s.gone)} title="Агент удалён">{label}</span>
	return (
		<button
			type="button"
			className={cls(s.link)}
			title={`Открыть ${label}`}
			onClick={e => {
				e.stopPropagation()
				openAgent(id)
			}}
		>
			{label}
		</button>
	)
}
