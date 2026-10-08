/**
 * Элемент «Внимания»: разрешение (кнопки прямо в карточке), ошибка (Открыть / Повторить),
 * результат (две строки превью, Открыть / Готово). Клик по карточке открывает агента.
 */
import { memo, useState, type MouseEvent } from 'react'
import { markDone } from '@/entities/attention'
import { StatusIcon } from '@/entities/agent'
import { PermissionButtons } from '@/features/permission'
import { clock } from '@/shared/lib/time'
import { openAgent, useStore } from '@/shared/model'
import { Button, Elapsed } from '@/shared/ui'
import { retryLast } from '../model/retry'
import type { AttentionCardProps } from '../model/types'
import s from './Attention.module.css'

const stop =
	(fn: () => void) =>
	(e: MouseEvent): void => {
		e.stopPropagation()
		fn()
	}

export const AttentionCard = memo(function AttentionCard({ item, selected, taskTitle }: AttentionCardProps) {
	const a = item.agent
	const role = useStore(st => (a.role ? st.roles.find(r => r.id === a.role)?.name : undefined))
	const [busy, setBusy] = useState(false)
	const open = (): void => openAgent(a.id)
	const sub = [role, taskTitle && taskTitle !== a.name ? taskTitle : null].filter(Boolean).join(' · ')

	const cls = [
		s.att,
		item.kind === 'permission' && s.perm,
		item.kind === 'error' && s.err,
		item.kind === 'result' && item.unread && s.unread,
		selected && s.sel,
	]
		.filter(Boolean)
		.join(' ')

	return (
		<div
			className={cls}
			// не role=button: внутри есть свои кнопки (Разрешить, Открыть…), вложенные кнопки ломают доступность
			role="group"
			aria-label={`${a.name}: ${item.kind === 'permission' ? 'запрос разрешения' : item.kind === 'error' ? 'ошибка' : 'результат'}`}
			tabIndex={0}
			data-attention={item.kind}
			data-agent={a.id}
			onClick={open}
			onKeyDown={e => {
				if (e.key === 'Enter' && e.target === e.currentTarget) open()
			}}
		>
			<div className={s.attH}>
				<StatusIcon state={item.kind === 'permission' ? 'wait' : item.kind === 'error' ? 'error' : 'done'} />
				<span className={s.nm}>{a.name}</span>
				{item.kind === 'result' && item.unread && <span className={s.newDot} title="Новый результат" />}
				{item.kind === 'permission' && a.turnStartedAt ? (
					<Elapsed from={Date.parse(a.turnStartedAt)} className={s.tm} title="Ход идёт" />
				) : (
					<span className={s.tm}>{clock(item.ts)}</span>
				)}
			</div>
			{sub && <div className={s.sub}>{sub}</div>}
			{item.kind === 'permission' && (
				<>
					<code className={s.cmd}>{item.text}</code>
					{item.requestId && <PermissionButtons agentId={a.id} requestId={item.requestId} className={s.acts} />}
				</>
			)}
			{item.kind === 'error' && (
				<>
					<div className={`${s.body} ${s.errText}`}>{item.text}</div>
					<div className={s.acts}>
						<Button size="sm" onClick={stop(open)}>
							Открыть
						</Button>
						<Button
							size="sm"
							loading={busy}
							onClick={stop(() => {
								setBusy(true)
								void retryLast(a.id).finally(() => setBusy(false))
							})}
						>
							Повторить
						</Button>
					</div>
				</>
			)}
			{item.kind === 'result' && (
				<>
					<div className={`${s.body} ${s.clamp2}`}>«{item.text}»</div>
					<div className={s.acts}>
						<Button size="sm" onClick={stop(open)}>
							Открыть
						</Button>
						<Button size="sm" onClick={stop(() => item.msgId && markDone(item.msgId))} title="Отметить просмотренным и убрать">
							Готово
						</Button>
					</div>
				</>
			)}
		</div>
	)
})
