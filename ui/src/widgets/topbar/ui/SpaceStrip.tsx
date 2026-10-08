/**
 * Лента пространств: чип на каждое (цвет, имя, статус, режим); клик — карточка с деталями.
 */
import { useState } from 'react'
import type { SpaceView } from '@contract'
import { SPACE_STATUS } from '@/entities/agent'
import { useStore } from '@/shared/model'
import { Icon, Popover, StatusDot } from '@/shared/ui'
import { SpaceDetails } from './SpaceDetails'
import { cssVars } from '@/shared/lib/style'
import s from './TopBar.module.css'

function SpaceChip({ space, count }: { space: SpaceView; count: number }) {
	const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
	const [open, setOpen] = useState(false)
	const st = SPACE_STATUS[space.status]
	return (
		<>
			<button
				ref={setAnchor}
				type="button"
				className={`${s.space} ${open ? s.spaceOpen : ''} ${space.status === 'failed' ? s.spaceFailed : ''}`}
				style={cssVars({ '--hue': space.color })}
				onClick={() => setOpen(o => !o)}
				aria-expanded={open}
				title={`${space.name} — ${st.label}${space.mode === 'external' ? ', внешний serve' : ''}\n${space.path}`}
			>
				<span className={s.spaceHue} />
				<span className={s.spaceName}>{space.name}</span>
				{count > 0 && <span className={s.spaceCount}>{count}</span>}
				{space.status !== 'ready' && <StatusDot color={st.color} pulse={st.pulse} size={6} />}
				{space.mode === 'external' && <Icon name="link" size={12} className={s.spaceExt} />}
			</button>
			<Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label={`Пространство ${space.name}`}>
				<SpaceDetails space={space} onDone={() => setOpen(false)} />
			</Popover>
		</>
	)
}

export function SpaceStrip() {
	const spaces = useStore(x => x.spaces)
	const agents = useStore(x => x.agents)
	if (!spaces.length) return <div className={s.strip} />
	return (
		<div className={s.strip} role="list" aria-label="Пространства">
			{spaces.map(sp => (
				<div role="listitem" key={sp.name} className={s.stripItem}>
					<SpaceChip space={sp} count={agents.filter(a => a.space === sp.name && a.status !== 'dead').length} />
				</div>
			))}
		</div>
	)
}
