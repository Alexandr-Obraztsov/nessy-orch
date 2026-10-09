import type { InputHTMLAttributes, ReactNode } from 'react'
import s from './Field.module.css'

export interface FieldProps {
	label: string
	hint?: ReactNode
	error?: string | null
	children: ReactNode
}

export function Field({ label, hint, error, children }: FieldProps) {
	return (
		<label className={s.field}>
			<span className={s.label}>{label}</span>
			{children}
			{error ? <span className={s.error}>{error}</span> : hint && <span className={s.hint}>{hint}</span>}
		</label>
	)
}

const cx = (mono: boolean | undefined, extra?: string): string => [s.input, mono && s.mono, extra].filter(Boolean).join(' ')

export function TextInput({ mono, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
	return <input className={cx(mono, className)} {...rest} />
}

