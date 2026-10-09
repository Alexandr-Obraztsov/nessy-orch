/**
 * Карточка агента — «стеклянная плитка» с постоянной вертикальной структурой, чтобы карточки в ряду
 * были ровными: шапка (статус, имя, роль, таймер, тихая «Остановить») → поручение ровно в 3 строки
 * с затуханием → окно плана в 5 строк («+n») → разделитель → низ, прижатый к низу карточки:
 * последняя команда, запрос разрешения («Разрешить / Отклонить»), ошибка или начало итога.
 * Клик по карточке открывает окно агента.
 */
import { memo, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { AGENT_STATE_LABEL, PlanList, StatusGlyph, ToolLine, agentState, canStop, elapsedMs, resultSummary, toolView } from '@/entities/agent'
import { parseReply, useReplyText } from '@/entities/message'
import { roleColor, useRole } from '@/entities/role'
import { PermissionButtons } from '@/features/permission'
import { StopButton } from '@/features/stop-agent'
import { plural } from '@/shared/lib/plural'
import { cssVars } from '@/shared/lib/style'
import { timer } from '@/shared/lib/time'
import { useNow } from '@/shared/lib/useNow'
import { useOverflow } from '@/shared/lib/useOverflow'
import { Shimmer, Sparkle } from '@/shared/ui'
import type { AgentCardProps } from '../model/types'
import s from './AgentCard.module.css'

/** строк в окне плана (вместе с «+n») — высота окна постоянна */
const PLAN_LINES = 5

/** Клик по кнопке или ссылке внутри карточки — не открывать окно. */
const onControl = (t: EventTarget): boolean => t instanceof Element && t.closest('button:not([data-open]), a') !== null

export const AgentCard = memo(function AgentCard({ agent, brief, taskTitle, index = 0, onOpen }: AgentCardProps) {
	const state = agentState(agent)
	const role = useRole(agent.role)
	const live = state === 'working' || state === 'starting' || state === 'wait'
	const now = useNow(live ? 1000 : 60_000)
	const ms = elapsedMs(agent, now)
	const briefRef = useRef<HTMLDivElement>(null)
	const clipped = useOverflow(briefRef, brief)
	const entries = agent.plan?.entries ?? []
	const perm = agent.pendingPermissions[0]

	const open = (e: MouseEvent): void => {
		if (onControl(e.target)) return
		// выделение текста мышью — не клик
		if (window.getSelection()?.toString()) return
		onOpen(agent.id)
	}
	const onKey = (e: KeyboardEvent<HTMLElement>): void => {
		if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(agent.id)
	}

	return (
		<article
			className={s.card}
			data-card={agent.id}
			data-state={state}
			aria-label={`${agent.name}, ${AGENT_STATE_LABEL[state]}`}
			style={cssVars({ '--i': Math.min(index, 12) })}
			onClick={open}
		>
			<header className={s.head} data-stoppable={canStop(agent) || undefined}>
				<StatusGlyph state={state} size={16} label={AGENT_STATE_LABEL[state]} />
				<button type="button" className={s.name} data-open="" onClick={() => onOpen(agent.id)} onKeyDown={onKey} title={`Открыть ${agent.name}`}>
					{agent.name}
				</button>
				{role && (
					<span className={s.role} style={cssVars({ '--rc': roleColor(role.color) })}>
						{role.name}
					</span>
				)}
				<span className={s.sp} />
				<span className={s.timer}>{ms !== null ? timer(ms) : ''}</span>
				{canStop(agent) && <StopButton agentId={agent.id} iconOnly className={s.stop} />}
			</header>

			{taskTitle !== undefined && <div className={s.task}>{taskTitle ?? 'Без задачи'}</div>}

			<div ref={briefRef} className={s.brief} data-clipped={clipped || undefined} data-empty={!brief || undefined}>
				{brief || 'Поручение ещё не пришло'}
			</div>

			<div className={s.plan} data-empty={entries.length === 0 || undefined}>
				{entries.length > 0 ? <PlanList entries={entries} live={state === 'working'} max={PLAN_LINES} lines /> : <span className={s.planNone}>Плана нет</span>}
			</div>

			<div className={s.foot}>
				{state === 'wait' && perm && (
					<div className={s.ask} role="group" aria-label={`${agent.name}: запрос разрешения`}>
						<div className={s.askTitle}>Просит разрешение</div>
						<code className={s.askCmd}>{perm.title}</code>
						<div className={s.askActs}>
							<PermissionButtons key={perm.requestId} agentId={agent.id} requestId={perm.requestId} />
							{agent.pendingPermissions.length > 1 && <span className={s.more}>ещё {agent.pendingPermissions.length - 1}</span>}
						</div>
					</div>
				)}

				{(state === 'working' || state === 'starting') && <Now agent={agent} />}

				{state === 'error' && <div className={s.error}>{agent.error ?? agent.lastReply?.failed ?? 'Ход завершился ошибкой'}</div>}

				{state === 'done' && <Result agent={agent} />}

				{state === 'idle' && <div className={s.quiet}>{agent.queued > 0 ? `В очереди: ${plural(agent.queued, 'сообщение', 'сообщения', 'сообщений')}` : 'Ждёт поручения'}</div>}
			</div>
		</article>
	)
})

/** Последняя команда: «⏺ Bash  npm test»; без инструмента — «✻ Думает…». */
function Now({ agent }: Pick<AgentCardProps, 'agent'>) {
	if (agent.status === 'starting')
		return (
			<div className={s.now}>
				<Sparkle tone="dim" />
				<Shimmer>Запускается…</Shimmer>
			</div>
		)
	const tool = agent.turnSteps > 0 ? agent.lastTool : null
	if (!tool)
		return (
			<div className={s.now}>
				<Sparkle />
				<Shimmer>Думает…</Shimmer>
			</div>
		)
	return (
		<div className={s.cmd}>
			<ToolLine tool={toolView(tool)} tone="run" aside={agent.turnSteps > 1 ? `${agent.turnSteps} шагов` : undefined} />
		</div>
	)
}

/** Начало итогового ответа и число источников. */
function Result({ agent }: Pick<AgentCardProps, 'agent'>) {
	const text = useReplyText(agent)
	const parsed = useMemo(() => (text ? parseReply(text) : null), [text])
	const summary = parsed ? summaryOf(parsed.body) : resultSummary(agent)
	if (!summary && !parsed?.sources.length) return <div className={s.quiet}>Готово</div>
	return (
		<div className={s.result}>
			{summary && <p className={s.resultText}>{summary}</p>}
			{parsed && parsed.sources.length > 0 && <span className={s.sources}>{plural(parsed.sources.length, 'источник', 'источника', 'источников')}</span>}
		</div>
	)
}

/** Первые строки ответа без разметки и служебного «Итог:». */
function summaryOf(body: string): string {
	return body
		.replace(/```[\s\S]*?```/g, ' ')
		.split('\n')
		.map(l => l.replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '').replace(/[*_`]{1,3}([^*_`]+)[*_`]{1,3}/g, '$1').trim())
		.filter(Boolean)
		.join(' ')
		.replace(/^(?:итог|ответ|резюме|вердикт)\s*[:—–-]\s*/i, '')
		.slice(0, 400)
}
