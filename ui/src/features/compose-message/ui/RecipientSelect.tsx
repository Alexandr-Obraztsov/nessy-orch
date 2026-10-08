/**
 * «Кому: имя ▾» — выпадающий список адресатов: активные агенты, ниже под разделителем — архив
 * (агент из архива проснётся при отправке).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentView } from '@contract'
import { agentStatusMeta } from '@/entities/agent'
import { Icon, Popover, StatusDot } from '@/shared/ui'
import type { RecipientSelectProps } from '../model/types'
import s from './Composer.module.css'

function dot(a: AgentView): { color: string; pulse: boolean } {
	const st = agentStatusMeta(a)
	return { color: st.color, pulse: st.pulse }
}

export function RecipientSelect({ value, active, archived, onPick }: RecipientSelectProps) {
	const [open, setOpen] = useState(false)
	const anchor = useRef<HTMLButtonElement>(null)
	const list = useRef<HTMLDivElement>(null)

	const choose = (id: string): void => {
		onPick(id)
		setOpen(false)
		document.querySelector<HTMLTextAreaElement>('textarea[data-composer]')?.focus()
	}

	// при открытии фокус — на выбранном пункте (или первом)
	useEffect(() => {
		if (!open) return
		const t = window.requestAnimationFrame(() => {
			const el = list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? list.current?.querySelector<HTMLButtonElement>('[role="option"]')
			el?.focus()
		})
		return () => window.cancelAnimationFrame(t)
	}, [open])

	// стрелки ↑/↓ — по пунктам списка
	const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
		e.preventDefault()
		const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
		const i = items.indexOf(document.activeElement as HTMLButtonElement)
		const d = e.key === 'ArrowDown' ? 1 : -1
		items[(i + d + items.length) % items.length]?.focus()
	}

	const item = (a: AgentView) => {
		const d = dot(a)
		const on = a.id === value?.id
		return (
			<button
				key={a.id}
				type="button"
				role="option"
				aria-selected={on}
				className={[s.option, on && s.optionOn].filter(Boolean).join(' ')}
				onClick={() => choose(a.id)}
			>
				<StatusDot color={d.color} pulse={d.pulse} size={7} />
				<span className={s.optName}>{a.name}</span>
				<span className={s.optSpace}>{a.space}</span>
				{on && <Icon name="check" size={13} className={s.optCheck} />}
			</button>
		)
	}

	return (
		<>
			<button
				ref={anchor}
				type="button"
				className={s.to}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label={value ? `Кому: ${value.name}` : 'Кому'}
				onClick={() => setOpen(v => !v)}
			>
				<span className={s.toLabel}>Кому:</span>
				{value && <StatusDot {...dot(value)} size={6} />}
				<span className={s.toName}>{value ? value.name : 'выберите'}</span>
				<Icon name="chevronDown" size={13} />
			</button>
			<Popover open={open} anchor={anchor.current} onClose={() => setOpen(false)} label="Кому" className={s.menu}>
				<div ref={list} role="listbox" aria-label="Адресат" onKeyDown={onKey}>
					{active.map(item)}
					{archived.length > 0 && (
						<>
							<div className={s.divider} role="presentation">
								Архив — проснётся при отправке
							</div>
							{archived.map(item)}
						</>
					)}
				</div>
			</Popover>
		</>
	)
}
