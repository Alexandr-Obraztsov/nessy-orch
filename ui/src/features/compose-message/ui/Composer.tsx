/**
 * Поле ввода сообщения агенту (как редактор в Obsidian: рамка, авто-высота, полоска снизу).
 * В ленте — «Кому: …» и префикс «@имя », в чате агента — фиксированный адресат.
 * Enter — отправить, Shift+Enter — новая строка. Под полем — что произойдёт при отправке
 * (работающий агент будет прерван, агент из архива проснётся).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { openDialog, useStore } from '@/shared/model'
import { Icon } from '@/shared/ui'
import { composerHint, composerPlaceholder } from '../lib/hint'
import { useAutoGrow } from '../lib/useAutoGrow'
import type { ComposerProps } from '../model/types'
import { useComposer } from '../model/useComposer'
import s from './Composer.module.css'
import { RecipientSelect } from './RecipientSelect'

export function Composer({ to, onSent, interruptToggle }: ComposerProps) {
	const m = useComposer(to, onSent, interruptToggle)
	const hasAgents = useStore(st => st.agents.length > 0)
	const input = useRef<HTMLTextAreaElement>(null)
	const [hi, setHi] = useState(0)
	useAutoGrow(input, m.text)
	useEffect(() => setHi(0), [m.suggestions.length])

	// писать некому — предлагаем создать агента
	if (!to && !hasAgents) {
		return (
			<div className={s.cta}>
				<span>Нет агентов — некому писать.</span>
				<button type="button" className={s.ctaBtn} onClick={() => openDialog('spawn')}>
					<Icon name="plus" size={14} />
					Создать агента
				</button>
			</div>
		)
	}

	const busy = m.recipient?.status === 'working' || m.recipient?.status === 'starting'
	const showToggle = !!interruptToggle && busy
	const hint = composerHint(m.recipient, showToggle ? m.interrupt : undefined)

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
		<div className={s.composer}>
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
								{a.archived && <em>архив</em>}
							</button>
						</li>
					))}
				</ul>
			)}
			<div className={s.box} onClick={e => e.target === e.currentTarget && input.current?.focus()}>
				<textarea
					ref={input}
					data-composer=""
					className={s.input}
					rows={1}
					value={m.text}
					placeholder={composerPlaceholder(m.recipient, !!to)}
					aria-label={m.recipient ? `Сообщение для ${m.recipient.name}` : 'Сообщение'}
					onChange={e => m.setText(e.target.value)}
					onKeyDown={onKey}
				/>
				<div className={s.bar}>
					{!to && <RecipientSelect value={m.recipient} active={m.active} archived={m.archived} onPick={m.pick} />}
					{showToggle && (
						<label className={s.interrupt} title="Снимите, чтобы сообщение встало в очередь и не сбивало текущий ход">
							<input type="checkbox" checked={m.interrupt} onChange={e => m.setInterrupt(e.target.checked)} data-interrupt="" />
							прервать текущий ход
						</label>
					)}
					<span className={s.keys}>
						<kbd>Enter</kbd> отправить · <kbd>Shift+Enter</kbd> строка
					</span>
					<button
						type="button"
						className={s.send}
						disabled={!m.canSend}
						aria-label="Отправить"
						title="Отправить (Enter)"
						onClick={() => void m.send()}
					>
						{m.sending ? <span className={s.spinner} /> : <Icon name="send" size={15} />}
					</button>
				</div>
			</div>
			{hint && (
				<div className={[s.hint, hint.tone === 'warn' && s.hintWarn].filter(Boolean).join(' ')} role="note">
					<Icon name={hint.tone === 'warn' ? 'bolt' : 'info'} size={12} />
					{hint.text}
				</div>
			)}
		</div>
	)
}
