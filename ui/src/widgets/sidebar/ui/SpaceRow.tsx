import { useState } from 'react'
import type { SpaceView } from '@contract'
import { SPACE_STATUS } from '@/entities/agent'
import { copyText } from '@/features/agent-actions'
import { openDialog } from '@/shared/model'
import { MenuItem, MenuSeparator, StatusDot } from '@/shared/ui'
import { RowMenu } from './RowMenu'
import { Row } from './Row'
import s from './Sidebar.module.css'

export interface SpaceRowProps {
	space: SpaceView
	onRemove: (sp: SpaceView) => void
}

export function SpaceRow({ space, onRemove }: SpaceRowProps) {
	const [menu, setMenu] = useState(false)
	const st = SPACE_STATUS[space.status]
	return (
		<Row
			lead={<StatusDot color={st.color} pulse={st.pulse} size={7} />}
			name={space.name}
			meta={<span className={s.path}>{space.path.replace(/^\/(Users|home)\/[^/]+/, '~')}</span>}
			title={`${space.path} — ${st.label}${space.error ? `: ${space.error}` : ''}`}
			label={space.name}
			onClick={() => setMenu(true)}
			onContextMenu={e => {
				e.preventDefault()
				setMenu(true)
			}}
			actions={
				<RowMenu label={`Пространство ${space.name}`} open={menu} onOpenChange={setMenu}>
					{close => (
						<>
							<MenuItem
								icon="plus"
								onClick={() => {
									close()
									openDialog('spawn', { space: space.name })
								}}
							>
								Новый агент здесь
							</MenuItem>
							<MenuItem
								icon="copy"
								onClick={() => {
									close()
									void copyText(space.path, 'Путь скопирован')
								}}
							>
								Копировать путь
							</MenuItem>
							{space.url && (
								<MenuItem
									icon="link"
									onClick={() => {
										close()
										void copyText(space.url ?? '', 'Адрес скопирован')
									}}
								>
									Копировать адрес serve
								</MenuItem>
							)}
							<MenuSeparator />
							<MenuItem
								icon="trash"
								danger
								onClick={() => {
									close()
									onRemove(space)
								}}
							>
								Удалить…
							</MenuItem>
						</>
					)}
				</RowMenu>
			}
		/>
	)
}
