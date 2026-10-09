/**
 * «Источники» из ответа агента — чипы: URL открываются в новой вкладке (бейдж сервиса GL/JI/WK/SG),
 * `путь:строка` и команды — текстовые чипы, клик копирует. И бейдж «Статус: DONE | …».
 */
import { copyText } from '@/shared/lib/clipboard'
import { cssVars } from '@/shared/lib/style'
import { Icon } from '@/shared/ui'
import { STATUS_LABEL, hostBadge } from '../lib/reply'
import type { SourcesProps, VerdictProps } from '../model/types'
import s from './Sources.module.css'

export function Sources({ sources, className }: SourcesProps) {
	if (sources.length === 0) return null
	return (
		<div className={[s.wrap, className].filter(Boolean).join(' ')}>
			<div className={s.h}>Источники</div>
			<div className={s.list}>
				{sources.map((c, i) =>
					c.kind === 'url' ? (
						<a key={i} className={s.chip} href={c.href} target="_blank" rel="noopener noreferrer" title={c.href}>
							<span className={s.fav} style={cssVars({ '--h': hostBadge(c.host).hue })}>
								{hostBadge(c.host).text}
							</span>
							<span className={s.label}>{c.label}</span>
							<Icon name="link" size={11} className={s.ext} />
						</a>
					) : (
						<button key={i} type="button" className={`${s.chip} ${s.code}`} title={`Скопировать: ${c.label}`} onClick={() => void copyText(c.label)}>
							<span className={s.label}>{c.label}</span>
						</button>
					),
				)}
			</div>
		</div>
	)
}

export function Verdict({ status }: VerdictProps) {
	return (
		<div className={s.verdict} data-status={status.code}>
			<b>{STATUS_LABEL[status.code]}</b>
			{status.reason && <span>{status.reason}</span>}
		</div>
	)
}
