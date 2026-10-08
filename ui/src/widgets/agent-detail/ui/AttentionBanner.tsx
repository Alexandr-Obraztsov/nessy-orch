/**
 * Баннер-действие сверху деталей, когда агент ждёт оператора:
 * разрешение (жёлтый, крупные «Разрешить / Отклонить»), ошибка (красный, «Повторить»),
 * новый результат (зелёный, «Отметить просмотренным»).
 */
import { useState } from 'react'
import { PermissionButtons } from '@/features/permission'
import { Icon } from '@/shared/ui'
import type { BannerProps } from '../model/types'
import s from './AgentDetail.module.css'

export function AttentionBanner({ agent, attention, onRetry, onSeen, onOpenResult, resultShown }: BannerProps) {
	const [retrying, setRetrying] = useState(false)

	if (attention.kind === 'permission')
		return (
			<section className={[s.banner, s.bannerWarn].join(' ')} role="alert" aria-label="Запрос разрешения">
				<div className={s.bannerHead}>
					<Icon name="alert" size={15} />
					<span>{agent.name} просит разрешение</span>
					{attention.more > 0 && <span className={s.bannerMore}>ещё {attention.more}</span>}
				</div>
				<code className={s.cmd} title={attention.title}>
					{attention.title}
				</code>
				<div className={s.bannerActs} data-size="lg">
					<PermissionButtons key={attention.requestId} agentId={agent.id} requestId={attention.requestId} />
				</div>
			</section>
		)

	if (attention.kind === 'error')
		return (
			<section className={[s.banner, s.bannerErr].join(' ')} role="alert" aria-label="Ошибка хода">
				<div className={s.bannerHead}>
					<Icon name="x" size={15} />
					<span>Ход завершился ошибкой</span>
				</div>
				<div className={s.errText}>{attention.text}</div>
				<div className={s.bannerActs}>
					<button
						type="button"
						className={s.bannerBtn}
						disabled={retrying}
						onClick={() => {
							setRetrying(true)
							void onRetry().finally(() => setRetrying(false))
						}}
						title="Отправить ваше последнее сообщение ещё раз"
					>
						{retrying ? <span className={s.spin} /> : <Icon name="refresh" size={13} />}
						Повторить
					</button>
				</div>
			</section>
		)

	return (
		<section className={[s.banner, s.bannerOk].join(' ')} aria-label="Новый результат">
			<div className={s.bannerHead}>
				<Icon name="check" size={15} />
				<span>Готов результат</span>
			</div>
			{attention.preview && !resultShown && (
				<button type="button" className={s.bannerPreview} onClick={onOpenResult} title="Открыть результат">
					{attention.preview}
				</button>
			)}
			<div className={s.bannerActs}>
				<button type="button" className={s.bannerBtn} onClick={() => onSeen(attention.msgId)}>
					<Icon name="eye" size={13} />
					Отметить просмотренным
				</button>
			</div>
		</section>
	)
}
