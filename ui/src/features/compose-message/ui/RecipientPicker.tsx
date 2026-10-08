import { useEffect, useRef } from 'react'
import type { AgentView } from '@contract'
import { AGENT_STATUS } from '@/entities/agent'
import { cssVars } from '@/shared/lib/cssVars'
import { spaceHue, useStore } from '@/shared/model'
import { StatusDot } from '@/shared/ui'
import s from './Composer.module.css'

interface Props {
	targets: AgentView[]
	value: string | null
	onPick: (id: string) => void
}

/** Чипы адресатов «Кому: …» (горизонтальная прокрутка). */
export function RecipientPicker({ targets, value, onPick }: Props) {
	const spaces = useStore(st => st.spaces)
	const box = useRef<HTMLDivElement>(null)
	// выбранный адресат всегда в зоне видимости
	useEffect(() => {
		const el = box.current?.querySelector<HTMLElement>('[aria-checked="true"]')
		const parent = box.current
		if (!el || !parent) return
		const l = el.offsetLeft - parent.offsetLeft
		if (l < parent.scrollLeft || l + el.offsetWidth > parent.scrollLeft + parent.clientWidth - 16)
			parent.scrollTo({ left: Math.max(0, l - 24), behavior: 'smooth' })
	}, [value])
	return (
		<div className={s.picker} role="radiogroup" aria-label="Кому">
			<span className={s.pickerLabel}>Кому</span>
			<div className={s.chips} ref={box}>
				{targets.map(a => {
					const hue = spaceHue(spaces, a.space)
					const on = a.id === value
					const st = AGENT_STATUS[a.status]
					return (
						<button
							key={a.id}
							type="button"
							role="radio"
							aria-checked={on}
							className={[s.chip, on && s.chipOn].filter(Boolean).join(' ')}
							style={cssVars({ '--h': hue })}
							title={`${a.name} · ${a.space} · ${st.label}`}
							onClick={() => onPick(a.id)}
						>
							<StatusDot color={st.color} pulse={st.pulse} size={6} />
							{a.name}
						</button>
					)
				})}
			</div>
		</div>
	)
}
