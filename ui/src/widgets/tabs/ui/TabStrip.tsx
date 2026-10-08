/**
 * Полоса вкладок главной панели (как в Obsidian): иконка/статус, заголовок, ×.
 * Средняя кнопка мыши закрывает вкладку; при переполнении — горизонтальная прокрутка.
 */
import { useEffect, useRef } from 'react'
import { RoleDot } from '@/entities/role'
import { closeTab, setView, useStore, useView } from '@/shared/model'
import { Icon, StatusDot } from '@/shared/ui'
import { useFeedUnread } from '../model/useFeedUnread'
import { tabMeta } from '../model/useTabMeta'
import s from './TabStrip.module.css'

export function TabStrip() {
	const tabs = useView(v => v.tabs)
	const active = useView(v => v.active)
	const agents = useStore(st => st.agents)
	const roles = useStore(st => st.roles)
	const feedActive = tabs[active]?.kind === 'feed'
	const unread = useFeedUnread(feedActive)
	const strip = useRef<HTMLDivElement>(null)

	// активная вкладка — в поле зрения
	useEffect(() => {
		strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
	}, [active, tabs.length])

	return (
		<div
			className={s.strip}
			ref={strip}
			role="tablist"
			aria-label="Вкладки"
			onWheel={e => {
				// вертикальное колесо прокручивает полосу по горизонтали
				if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY
			}}
		>
			{tabs.map((t, i) => {
				const m = tabMeta(t, { agents, roles })
				const on = i === active
				return (
					<div
						key={m.key}
						className={`${s.tab} ${on ? s.active : ''}`}
						role="tab"
						aria-selected={on}
						tabIndex={on ? 0 : -1}
						title={m.title}
						onClick={() => setView({ active: i })}
						onAuxClick={e => {
							if (e.button === 1 && m.closable) {
								e.preventDefault()
								closeTab(i)
							}
						}}
						onMouseDown={e => e.button === 1 && e.preventDefault()}
						onKeyDown={e => {
							if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
								const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
								setView({ active: next })
								strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
							} else if ((e.key === 'Delete' || e.key === 'Backspace') && m.closable) closeTab(i)
						}}
					>
						<span className={s.icon}>
							{m.status ? (
								<StatusDot color={m.status.color} pulse={m.status.pulse} size={7} />
							) : m.roleHue !== null ? (
								<RoleDot hue={m.roleHue} size={7} />
							) : (
								<Icon name={m.icon} size={14} />
							)}
						</span>
						<span className={s.title}>{m.title}</span>
						{t.kind === 'feed' && unread > 0 && <span className={s.badge}>{unread > 99 ? '99+' : unread}</span>}
						{m.closable && (
							<button
								type="button"
								className={s.close}
								aria-label={`Закрыть вкладку ${m.title}`}
								tabIndex={-1}
								onClick={e => {
									e.stopPropagation()
									closeTab(i)
								}}
							>
								<Icon name="close" size={12} strokeWidth={2} />
							</button>
						)}
					</div>
				)
			})}
		</div>
	)
}
