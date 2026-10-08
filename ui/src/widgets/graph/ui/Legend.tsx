/** Сворачиваемая легенда: статусы агентов, виды рёбер и пакетов, значки внимания. */
import { useState } from 'react'
import type { AgentStatus } from '@contract'
import { AGENT_STATUS } from '@/entities/agent'
import { Icon } from '@/shared/ui'
import o from './Overlays.module.css'

const KEY = 'nessy-orch:graph-legend'
const STATUSES: AgentStatus[] = ['idle', 'working', 'starting', 'sleeping', 'error', 'dead']

function readOpen(fallback: boolean): boolean {
	try {
		const v = localStorage.getItem(KEY)
		return v === null ? fallback : v === '1'
	} catch {
		return fallback
	}
}

function StatusSample({ status }: { status: AgentStatus }) {
	const c = AGENT_STATUS[status].color
	const dashed = status === 'working' || status === 'starting' || status === 'dead'
	return (
		<svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
			<circle
				r="5.5"
				fill={status === 'dead' || status === 'sleeping' ? 'none' : `color-mix(in srgb, ${c} 22%, transparent)`}
				stroke={c}
				strokeWidth="1.5"
				strokeDasharray={dashed ? '2.5 2' : undefined}
				opacity={status === 'sleeping' ? 0.6 : 1}
			/>
		</svg>
	)
}

function LineSample({ dashed }: { dashed?: boolean }) {
	return (
		<svg width="20" height="8" aria-hidden="true">
			<line x1="1" y1="4" x2="19" y2="4" stroke="var(--text-3)" strokeWidth={dashed ? 1 : 2} strokeDasharray={dashed ? '3 3' : undefined} strokeLinecap="round" />
		</svg>
	)
}

function DotSample({ color }: { color: string }) {
	return (
		<svg width="14" height="10" viewBox="-7 -5 14 10" aria-hidden="true">
			<circle r="4.5" fill={color} opacity="0.25" />
			<circle r="2.2" fill={color} />
		</svg>
	)
}

export function Legend({ defaultOpen }: { defaultOpen: boolean }) {
	const [open, setOpen] = useState(() => readOpen(defaultOpen))
	const toggle = (): void => {
		setOpen(v => {
			try {
				localStorage.setItem(KEY, v ? '0' : '1')
			} catch {
				/* хранилище недоступно — просто не запоминаем */
			}
			return !v
		})
	}
	return (
		<div className={`${o.legend} ${o.glass} ${open ? '' : o.legendClosed}`}>
			<button type="button" className={o.legendHead} onClick={toggle} aria-expanded={open}>
				<Icon name="chevronDown" size={13} />
				Легенда
			</button>
			{open && (
				<div className={o.legendBody}>
					{STATUSES.map(st => (
						<span key={st} className={o.legendItem}>
							<StatusSample status={st} />
							{AGENT_STATUS[st].label}
						</span>
					))}
					<span className={o.legendGroup}>Связи</span>
					<span className={o.legendItem}>
						<LineSample dashed />
						запустил
					</span>
					<span className={o.legendItem}>
						<LineSample />
						переписка
					</span>
					<span className={o.legendItem}>
						<DotSample color="var(--accent)" />
						сообщение
					</span>
					<span className={o.legendItem}>
						<DotSample color="var(--st-starting)" />
						ответ
					</span>
					<span className={o.legendItem}>
						<DotSample color="var(--danger)" />
						не доставлено
					</span>
					<span className={o.legendItem}>
						<DotSample color="var(--warn)" />
						очередь / разрешение
					</span>
				</div>
			)}
		</div>
	)
}
