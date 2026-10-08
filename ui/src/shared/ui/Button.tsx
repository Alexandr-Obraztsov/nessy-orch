import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import s from './Button.module.css'
import { Icon, type IconName } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant
	size?: 'md' | 'sm'
	icon?: IconName
	loading?: boolean
	children?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
	{ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest },
	ref,
) {
	const cls = [s.btn, s[variant], size === 'sm' && s.sm, !children && s.icon, className].filter(Boolean).join(' ')
	return (
		<button ref={ref} type="button" className={cls} disabled={disabled || loading} {...rest}>
			{loading ? <span className={s.spinner} /> : icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
			{children}
		</button>
	)
})

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> {
	icon: IconName
	/** обязательная подпись для доступности и подсказки */
	label: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, variant = 'ghost', ...rest }, ref) {
	return <Button ref={ref} variant={variant} aria-label={label} title={label} {...rest} />
})
