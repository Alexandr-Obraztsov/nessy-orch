import s from './Switch.module.css'

export interface SwitchProps {
	checked: boolean
	onChange: (v: boolean) => void
	label: string
	hint?: string
	disabled?: boolean
}

/** Переключатель «вкл/выкл» с подписью; вся строка кликабельна. */
export function Switch({ checked, onChange, label, hint, disabled }: SwitchProps) {
	return (
		<label className={s.row}>
			<input
				type="checkbox"
				role="switch"
				className={s.input}
				checked={checked}
				disabled={disabled}
				onChange={e => onChange(e.target.checked)}
			/>
			<span className={s.track} aria-hidden="true">
				<span className={s.thumb} />
			</span>
			<span className={s.text}>
				<span className={s.label}>{label}</span>
				{hint && <span className={s.hint}>{hint}</span>}
			</span>
		</label>
	)
}
