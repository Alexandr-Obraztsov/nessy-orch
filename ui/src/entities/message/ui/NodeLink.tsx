import { cssVars } from '@/shared/lib/style'
import { YOU, nodeLabel, openAgent, spaceHue, useStore } from '@/shared/model'
import s from './NodeLink.module.css'

/** Имя узла в маршруте сообщения: «Вы», «система» или кликабельное имя агента цветом пространства. */
export function NodeLink({ id, strong }: { id: string; strong?: boolean }) {
	const agent = useStore(st => st.agents.find(a => a.id === id))
	const label = useStore(st => nodeLabel(st.agents, id))
	const hue = useStore(st => (agent ? spaceHue(st.spaces, agent.space) : null))
	if (id === YOU) return <span className={[s.name, s.you, strong && s.strong].filter(Boolean).join(' ')}>Вы</span>
	if (!agent) return <span className={[s.name, s.gone, strong && s.strong].filter(Boolean).join(' ')}>{label}</span>
	return (
		<button
			type="button"
			className={[s.name, s.link, strong && s.strong].filter(Boolean).join(' ')}
			style={cssVars({ '--h': hue ?? 170 })}
			title={`Открыть чат с ${agent.name}`}
			onClick={e => {
				e.stopPropagation()
				openAgent(id)
			}}
		>
			{label}
		</button>
	)
}
