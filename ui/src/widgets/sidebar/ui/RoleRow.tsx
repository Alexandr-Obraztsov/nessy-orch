import { useState } from 'react'
import type { RoleView } from '@contract'
import { RoleDot } from '@/entities/role'
import { openDialog, openRole } from '@/shared/model'
import { MenuItem, MenuSeparator } from '@/shared/ui'
import { RowMenu } from './RowMenu'
import { Row } from './Row'

export interface RoleRowProps {
	role: RoleView
	users: number
	active: boolean
	onRemove: (r: RoleView) => void
}

export function RoleRow({ role, users, active, onRemove }: RoleRowProps) {
	const [menu, setMenu] = useState(false)
	return (
		<Row
			active={active}
			lead={<RoleDot hue={role.color} />}
			name={role.name}
			meta={users > 0 ? users : undefined}
			title={role.description || role.name}
			label={role.name}
			onClick={() => openRole(role.id)}
			onContextMenu={e => {
				e.preventDefault()
				setMenu(true)
			}}
			actions={
				<RowMenu label={`Роль ${role.name}`} open={menu} onOpenChange={setMenu}>
					{close => (
						<>
							<MenuItem
								icon="edit"
								onClick={() => {
									close()
									openRole(role.id)
								}}
							>
								Открыть
							</MenuItem>
							<MenuItem
								icon="play"
								onClick={() => {
									close()
									openDialog('spawn', { role: role.id })
								}}
							>
								Запустить агента
							</MenuItem>
							<MenuSeparator />
							<MenuItem
								icon="trash"
								danger
								onClick={() => {
									close()
									onRemove(role)
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
