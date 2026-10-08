/**
 * Ростер: поиск и список агентов, сгруппированных по пространствам.
 */
import { useRef } from 'react'
import { NARROW, useMedia } from '@/shared/lib/useMedia'
import { openDialog } from '@/shared/model'
import { Icon, IconButton, Kbd } from '@/shared/ui'
import { useRoster } from '../model/useRoster'
import { RosterEmpty } from './RosterEmpty'
import { RosterGroup } from './RosterGroup'
import s from './Roster.module.css'

export function Roster() {
	const r = useRoster()
	const narrow = useMedia(NARROW)
	const input = useRef<HTMLInputElement>(null)
	const searching = r.query.trim().length > 0
	const alive = r.agents.filter(a => a.status !== 'dead').length

	return (
		<div className={s.roster}>
			<div className={s.head}>
				<div className={s.titleRow}>
					<h2 className={s.title}>Агенты</h2>
					<span className={s.total}>{alive}</span>
					<span className={s.grow} />
					<IconButton icon="plus" size="sm" label="Новый агент (N)" onClick={() => openDialog('spawn')} />
				</div>
				{r.agents.length > 0 && (
					<label className={s.search}>
						<Icon name="search" size={15} />
						<input
							ref={input}
							type="search"
							value={r.query}
							onChange={e => r.setQuery(e.target.value)}
							onKeyDown={e => {
								if (e.key === 'Escape' && r.query) {
									e.stopPropagation()
									r.setQuery('')
								}
							}}
							placeholder="Поиск по имени, задаче, инструменту"
							aria-label="Поиск агентов"
							spellCheck={false}
						/>
						{r.query && (
							<button
								type="button"
								className={s.clear}
								aria-label="Очистить поиск"
								onClick={() => {
									r.setQuery('')
									input.current?.focus()
								}}
							>
								<Icon name="x" size={14} />
							</button>
						)}
					</label>
				)}
			</div>

			<div className={s.list}>
				{r.agents.length === 0 && r.spaces.length === 0 ? (
					<RosterEmpty hasSpaces={false} />
				) : (
					<>
						{r.groups.map(g => (
							<RosterGroup
								key={g.key}
								group={g}
								collapsed={r.collapsed.has(g.key)}
								onToggle={() => r.toggle(g.key)}
								selected={r.selected}
								searching={searching}
							/>
						))}
						{searching && r.shown === 0 && (
							<p className={s.noResults}>
								Ничего не найдено по «<b>{r.query.trim()}</b>»
							</p>
						)}
						{!searching && r.agents.length === 0 && <RosterEmpty hasSpaces />}
					</>
				)}
			</div>

			{!narrow && (
				<div className={s.foot}>
					<span>
						<Kbd>N</Kbd> агент
					</span>
					<span>
						<Kbd>S</Kbd> пространство
					</span>
					<span>
						<Kbd>/</Kbd> ввод
					</span>
					<span>
						<Kbd>Esc</Kbd> закрыть
					</span>
				</div>
			)}
		</div>
	)
}
