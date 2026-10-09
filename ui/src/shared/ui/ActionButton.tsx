/**
 * Кнопка действия на карточке и в окне агента (30px; lg — 44px для пальца).
 * Подпись лежит в [data-label]: родитель может спрятать её по ширине, оставив иконку.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import s from './ActionButton.module.css'
import { Icon, type IconName } from './Icon'

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	/**
	 * accent — залитая терракотовая («Разрешить»), danger — красная («Точно?»),
	 * plain — нейтральная с границей, quiet — тихая иконка без фона
	 */
	tone?: 'plain' | 'accent' | 'danger' | 'quiet'
	size?: 'sm' | 'lg'
	icon?: IconName
	busy?: boolean
	/** одноразовая анимация отклика: pop — «принято», shake — «отклонено» */
	pulse?: 'pop' | 'shake' | null
	children?: ReactNode
}

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
	{ tone = 'plain', size = 'sm', icon, busy, pulse, className, children, ...rest },
	ref,
) {
	const cls = [s.btn, s[tone], s[size], children === undefined && s.iconOnly, pulse && s[pulse], className].filter(Boolean).join(' ')
	return (
		<button ref={ref} type="button" className={cls} aria-busy={busy || undefined} {...rest}>
			{busy ? <span className={s.spin} aria-hidden="true" /> : icon && <Icon name={icon} size={size === 'lg' ? 16 : 14} strokeWidth={2} />}
			{children !== undefined && <span data-label="">{children}</span>}
		</button>
	)
})
