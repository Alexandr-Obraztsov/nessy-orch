/** «Результат»: последний ответ агента крупно (markdown), «Копировать», чипы ссылок (URL, Jira, MR). */
import { useMemo } from 'react'
import { copyText } from '@/features/agent-actions'
import { MarkdownBody } from '@/entities/message'
import { clock } from '@/shared/lib/time'
import { Icon } from '@/shared/ui'
import { extractLinks } from '../lib/links'
import type { ResultTabProps } from '../model/types'
import s from './AgentDetail.module.css'

export function ResultTab({ agent, text }: ResultTabProps) {
	const reply = agent.lastReply
	const links = useMemo(() => (text ? extractLinks(text) : []), [text])
	const working = agent.status === 'working' || agent.status === 'starting'

	if (!reply || text === null)
		return (
			<div className={s.empty}>
				{agent.status === 'error'
					? 'Ход упал без ответа. Откройте «Шаги», чтобы увидеть, где агент остановился.'
					: working
						? 'Результат появится, когда агент ответит на ход.'
						: 'Агент ещё не отвечал вам.'}
			</div>
		)

	return (
		<div className={s.result}>
			<div className={s.resTop}>
				<span>
					{working ? 'Предыдущий ответ' : 'Последний ответ'} · {clock(reply.ts)}
				</span>
				<button type="button" className={s.ghostBtn} onClick={() => void copyText(text, 'Ответ скопирован')}>
					<Icon name="copy" size={13} />
					Копировать
				</button>
			</div>
			{reply.failed && (
				<div className={s.resFailed} role="note">
					<Icon name="x" size={13} />
					<span>Ход завершился ошибкой: {reply.failed}</span>
				</div>
			)}
			{links.length > 0 && (
				<div className={s.chips} aria-label="Ссылки из ответа">
					{links.map(l =>
						l.kind === 'url' ? (
							<a key={l.value} className={s.chip} href={l.value} target="_blank" rel="noopener noreferrer" title={l.value}>
								<Icon name="link" size={12} />
								{l.label}
							</a>
						) : (
							<button
								key={l.value}
								type="button"
								className={s.chip}
								title={`Скопировать ${l.value}`}
								onClick={() => void copyText(l.value, `Скопировано: ${l.value}`)}
							>
								<span className={s.chipKind}>{l.kind === 'jira' ? 'Jira' : 'MR'}</span>
								{l.label}
							</button>
						),
					)}
				</div>
			)}
			<div className={[s.resBody, reply.failed && s.resBodyFailed].filter(Boolean).join(' ')}>
				<MarkdownBody text={text} />
			</div>
		</div>
	)
}
