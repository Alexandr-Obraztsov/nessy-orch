/**
 * Пункты всплывающего меню (внутри Popover): строка 28px, иконка, подпись, подсказка справа.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import s from './Menu.module.css'

export interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	icon?: IconName
	/** подсказка справа (клавиша, id) */
	hint?: ReactNode
	danger?: boolean
}

export function MenuItem({ icon, hint, danger, className, children, ...rest }: MenuItemProps) {
	return (
		<button type="button" role="menuitem" className={[s.item, danger && s.danger, className].filter(Boolean).join(' ')} {...rest}>
			{icon && <Icon name={icon} size={15} />}
			<span>{children}</span>
			{hint !== undefined && <span className={s.hint}>{hint}</span>}
		</button>
	)
}

export function MenuSeparator() {
	return <div className={s.sep} role="separator" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
	return <div className={s.label}>{children}</div>
}
