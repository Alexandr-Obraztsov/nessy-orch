import type { RoleView } from '@contract'
import { RoleDot } from '@/entities/role'
import s from './SpawnAgentDialog.module.css'

export interface RolePickerProps {
	value: string
	roles: RoleView[]
	onChange: (id: string) => void
}

/** Список ролей (радиокнопки-строки): «Без роли» и сохранённые роли с описанием. */
export function RolePicker({ value, roles, onChange }: RolePickerProps) {
	const opts = [{ id: '', name: 'Без роли', description: 'Обычный агент nessy', color: null as number | null }, ...roles]
	return (
		<div className={s.roles} role="radiogroup" aria-label="Роль">
			{opts.map(r => (
				<label key={r.id || '__none'} className={s.role}>
					<input type="radio" name="spawn-role" value={r.id} checked={value === r.id} onChange={() => onChange(r.id)} />
					{r.color === null ? <span className={s.noRole} aria-hidden="true" /> : <RoleDot hue={r.color} />}
					<span className={s.roleName}>{r.name}</span>
					{r.description && <span className={s.roleDesc}>{r.description}</span>}
				</label>
			))}
		</div>
	)
}
