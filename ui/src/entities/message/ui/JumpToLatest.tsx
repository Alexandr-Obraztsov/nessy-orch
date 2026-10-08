import { Icon } from '@/shared/ui'
import s from './JumpToLatest.module.css'

/** Плавающая кнопка «↓ N новых» (или просто «вниз»), когда пользователь отлистал вверх. */
export function JumpToLatest({ visible, unseen, onClick }: { visible: boolean; unseen: number; onClick: () => void }) {
	if (!visible) return null
	return (
		<button
			type="button"
			className={[s.jump, unseen > 0 && s.hasNew].filter(Boolean).join(' ')}
			onClick={onClick}
			aria-label={unseen > 0 ? `${unseen} новых — прокрутить вниз` : 'Прокрутить вниз'}
		>
			<Icon name="arrowDown" size={16} strokeWidth={2.2} />
			{unseen > 0 && <span>{unseen > 99 ? '99+' : unseen} новых</span>}
		</button>
	)
}
