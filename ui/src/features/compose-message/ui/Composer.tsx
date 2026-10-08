/**
 * Поле ввода сообщения агенту. В ленте — с выбором адресата и «@имя », в чате агента — фиксированный адресат.
 * Enter — отправить, Shift+Enter — новая строка.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { openDialog } from '@/shared/model'
import { Button, Icon } from '@/shared/ui'
import { useAutoGrow } from '../lib/useAutoGrow'
import type { ComposerProps } from '../model/types'
import { useComposer } from '../model/useComposer'
import s from './Composer.module.css'
import { RecipientPicker } from './RecipientPicker'

export function Composer({ to, disabledReason, placeholder, onSent }: ComposerProps) {
	const m = useComposer(to, onSent)
	const input = useRef<HTMLTextAreaElement>(null)
	const [hi, setHi] = useState(0)
	useAutoGrow(input, m.text)
	useEffect(() => setHi(0), [m.suggestions.length])

	// писать некому — предлагаем запустить агента
	if (!to && m.targets.length === 0) {
		return (
			<div className={s.cta}>
				<div className={s.ctaText}>
					<b>Нет активных агентов</b>
					<span>Запустите агента, чтобы начать переписку</span>
				</div>
				<Button variant="primary" size="sm" icon="plus" onClick={() => openDialog('spawn')}>
					Новый агент
				</Button>
			</div>
		)
	}

	const disabled = !!disabledReason
	const target = m.targets.find(a => a.id === m.recipient)
	const ph = disabled ? disabledReason : (placeholder ?? (target ? `Сообщение для ${target.name}…` : 'Сообщение…'))
	const canSend = !disabled && !!m.recipient && m.text.trim().length > 0 && !m.sending

	const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (e.nativeEvent.isComposing) return
		const sug = m.suggestions
		if (sug.length > 0) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault()
				const d = e.key === 'ArrowDown' ? 1 : -1
				setHi(i => (i + d + sug.length) % sug.length)
				return
			}
			if (e.key === 'Tab' || e.key === 'Enter') {
				const a = sug[hi]
				if (a) {
					e.preventDefault()
					m.complete(a)
					return
				}
			}
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			void m.send()
		}
	}

	return (
		<div className={[s.composer, disabled && s.disabled].filter(Boolean).join(' ')}>
			{!to && <RecipientPicker targets={m.targets} value={m.recipient} onPick={m.pick} />}
			{m.suggestions.length > 0 && (
				<ul className={s.suggest} role="listbox" aria-label="Агенты">
					{m.suggestions.map((a, i) => (
						<li key={a.id} role="option" aria-selected={i === hi}>
							<button
								type="button"
								className={i === hi ? s.sugOn : undefined}
								onMouseDown={e => {
									e.preventDefault()
									m.complete(a)
									input.current?.focus()
								}}
							>
								<b>@{a.name}</b>
								<span>{a.space}</span>
								<code>{a.id}</code>
							</button>
						</li>
					))}
				</ul>
			)}
			<div className={s.row}>
				<textarea
					ref={input}
					data-composer=""
					className={s.input}
					rows={1}
					value={m.text}
					disabled={disabled}
					placeholder={ph}
					aria-label={target ? `Сообщение для ${target.name}` : 'Сообщение'}
					onChange={e => m.setText(e.target.value)}
					onKeyDown={onKey}
				/>
				<button
					type="button"
					className={s.send}
					disabled={!canSend}
					aria-label="Отправить"
					title="Отправить (Enter)"
					onClick={() => void m.send()}
				>
					{m.sending ? <span className={s.spinner} /> : <Icon name="send" size={18} strokeWidth={2.2} />}
				</button>
			</div>
			{disabled && (
				<div className={s.note}>
					<Icon name="info" size={13} />
					{disabledReason}
				</div>
			)}
		</div>
	)
}
