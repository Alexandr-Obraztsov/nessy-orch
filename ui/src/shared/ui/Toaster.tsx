import s from './Toaster.module.css'
import { Icon } from './Icon'
import { dismissToast, useToasts } from './toast'

const ICON = { info: 'info', success: 'check', error: 'alert' } as const

export function Toaster() {
	const list = useToasts()
	return (
		<div className={s.wrap} role="status" aria-live="polite">
			{list.map(t => (
				<div key={t.id} className={`${s.toast} ${s[t.kind]}`}>
					<Icon name={ICON[t.kind]} size={15} />
					<span>{t.text}</span>
					<button type="button" className="sr-only" onClick={() => dismissToast(t.id)}>
						закрыть
					</button>
				</div>
			))}
		</div>
	)
}
