import { useMemo } from 'react'
import { MarkdownBody } from '@/entities/message'
import { copyText } from '@/shared/lib/clipboard'
import { cssVars } from '@/shared/lib/style'
import { clock } from '@/shared/lib/time'
import { Icon, IconButton } from '@/shared/ui'
import { STATUS_LABEL, hostBadge, parseReply } from '../lib/reply'
import type { ResultProps } from '../model/types'
import s from './AgentDetail.module.css'

/**
 * Итоговый ответ — только финальное сообщение хода (lastReply). Раздел «Источники» показан
 * чипами: URL открываются в новой вкладке, `путь:строка` и команды — текстовые чипы (клик копирует).
 */
export function Result({ agent, text }: ResultProps) {
	const reply = agent.lastReply
	const parsed = useMemo(() => (text ? parseReply(text) : null), [text])
	if (!reply || !parsed || text === null) return null
	const working = agent.status === 'working' || agent.status === 'starting'
	return (
		<section className={s.sec} aria-label="Итоговый ответ">
			<h4 className={s.h4}>
				{working ? 'Предыдущий ответ' : 'Итоговый ответ'}
				<em>{clock(reply.ts)}</em>
				<IconButton icon="copy" label="Копировать ответ" size="sm" className={s.copy} onClick={() => void copyText(text, 'Ответ скопирован')} />
			</h4>
			<div className={[s.result, reply.failed && s.resultFailed].filter(Boolean).join(' ')}>
				{parsed.status && (
					<div className={s.verdict} data-status={parsed.status.code}>
						<b>{STATUS_LABEL[parsed.status.code]}</b>
						{parsed.status.reason && <span>{parsed.status.reason}</span>}
					</div>
				)}
				{parsed.body && <MarkdownBody text={parsed.body} className={s.md} />}
				{parsed.sources.length > 0 && (
					<>
						<h5 className={s.h5}>Источники · {parsed.sources.length}</h5>
						<div className={s.sources}>
							{parsed.sources.map((c, i) =>
								c.kind === 'url' ? (
									<a key={i} className={s.src} href={c.href} target="_blank" rel="noopener noreferrer" title={c.href}>
										<span className={s.fav} style={cssVars({ '--h': hostBadge(c.host).hue })}>
											{hostBadge(c.host).text}
										</span>
										<span className={s.srcText}>{c.label}</span>
										<span className={s.srcHost}>{c.host}</span>
										<Icon name="link" size={11} />
									</a>
								) : (
									<button
										key={i}
										type="button"
										className={`${s.src} ${s.srcCode}`}
										title={`Скопировать: ${c.label}`}
										onClick={() => void copyText(c.label, 'Скопировано')}
									>
										<span className={s.srcText}>{c.label}</span>
									</button>
								),
							)}
						</div>
					</>
				)}
			</div>
		</section>
	)
}
