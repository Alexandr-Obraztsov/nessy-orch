/**
 * Справочник «Роли»: список ролей слева, редактор выбранной справа (прежний RoleEditor).
 */
import { RoleDot } from '@/entities/role'
import { RoleEditor } from '@/features/role-editor'
import { openPage, openRole, useStore } from '@/shared/model'
import { Button, Icon, RefPage } from '@/shared/ui'
import s from './RolesPage.module.css'

export function RolesPage({ roleId }: { roleId: string | null }) {
	const roles = useStore(st => st.roles)
	const agents = useStore(st => st.agents)
	return (
		<RefPage
			title="Роли"
			count={roles.length}
			backLabel="К поручениям"
			onBack={() => openPage({ kind: 'main' })}
			actions={
				<Button size="sm" variant="primary" icon="plus" onClick={() => openRole(null)}>
					Новая роль
				</Button>
			}
		>
			<div className={s.split}>
				<nav className={s.list} aria-label="Список ролей">
					{roles.length === 0 && <p className={s.none}>Ролей пока нет — создайте первую справа.</p>}
					{roles.map(r => {
						const n = agents.filter(a => a.role === r.id).length
						return (
							<button
								key={r.id}
								type="button"
								className={s.item}
								aria-current={roleId === r.id || undefined}
								onClick={() => openRole(r.id)}
							>
								<span className={s.itemTop}>
									<RoleDot hue={r.color} />
									<span className={s.itemName}>{r.name}</span>
									{n > 0 && <span className={s.itemN}>{n}</span>}
								</span>
								{r.description && <span className={s.itemDesc}>{r.description}</span>}
							</button>
						)
					})}
					{roleId === null && (
						<div className={s.item} aria-current>
							<span className={s.itemTop}>
								<Icon name="plus" size={12} />
								<span className={s.itemName}>Новая роль</span>
							</span>
						</div>
					)}
				</nav>
				<div className={s.editor}>
					<RoleEditor key={roleId ?? '__new'} id={roleId} />
				</div>
			</div>
		</RefPage>
	)
}
