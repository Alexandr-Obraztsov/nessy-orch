/**
 * Компактная кнопка действия в строке таблицы и в панели деталей (26px; lg — 44px для пальца).
 * Подпись лежит в [data-label]: родитель может спрятать её по ширине, оставив иконку.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import s from './ActionButton.module.css'
import { Icon, type IconName } from './Icon'

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	/** ok — залитая зелёная («Разрешить»), danger — красная обводка («Точно?»), plain — нейтральная */
	tone?: 'plain' | 'ok' | 'danger'
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
	const cls = [s.btn, s[tone], s[size], pulse && s[pulse], className].filter(Boolean).join(' ')
	return (
		<button ref={ref} type="button" className={cls} aria-busy={busy || undefined} {...rest}>
			{busy ? <span className={s.spin} aria-hidden="true" /> : icon && <Icon name={icon} size={size === 'lg' ? 16 : 13} strokeWidth={2.2} />}
			{children !== undefined && <span data-label="">{children}</span>}
		</button>
	)
})
