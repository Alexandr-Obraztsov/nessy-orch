/**
 * Строка таблицы (~40px): статус · агент и роль · задача · прогресс плана и текущий шаг ·
 * «сейчас» (инструмент + живой таймер) · время · действия. На узкой таблице колонки прячутся
 * (container queries в CSS), на телефоне строка становится двухстрочной.
 */
import { memo, type KeyboardEvent } from 'react'
import type { AgentView } from '@contract'
import { AGENT_STATE_LABEL, PlanBar, StatusIcon, canStop, elapsedMs, planProgress, resultSummary, toolLabel, toolStartedAt, type AgentState } from '@/entities/agent'
import { roleColor } from '@/entities/role'
import { PermissionButtons } from '@/features/permission'
import { StopButton } from '@/features/stop-agent'
import { cssVars } from '@/shared/lib/style'
import { timer } from '@/shared/lib/time'
import type { AgentRowProps } from '../model/types'
import s from './AgentTable.module.css'

/** Текст шага под баром: текущий пункт плана или что агент делает без плана. */
function stepText(a: AgentView, state: AgentState): string {
	if (state === 'starting') return 'запускается…'
	if (state === 'idle') return a.queued > 0 ? `в очереди сообщений: ${a.queued}` : 'ждёт поручения'
	if (state === 'done') return ''
	return planProgress(a)?.step ?? ''
}

function Now({ a, state, now }: { a: AgentView; state: AgentState; now: number }) {
	switch (state) {
		case 'wait': {
			const p = a.pendingPermissions[0]
			return (
				<span className={s.perm}>
					<span className={s.badge}>разрешение</span>
					<span className={s.arg} title={p?.title}>
						{p?.title}
					</span>
				</span>
			)
		}
		case 'error': {
			const text = a.error ?? a.lastReply?.failed ?? 'ход завершился ошибкой'
			return (
				<span className={s.err} title={text}>
					{text}
				</span>
			)
		}
		case 'working': {
			// lastTool хранится с прошлых ходов: в этом ходе инструментов ещё не было — агент думает
			const tool = a.turnSteps > 0 ? a.lastTool : null
			const since = tool ? toolStartedAt(a, now) : Date.parse(a.turnStartedAt ?? a.lastActivityAt)
			const t = tool ? toolLabel(tool) : null
			return (
				<>
					{t ? (
						<>
							<span className={s.tool}>{t.name}</span>
							<span className={s.arg} title={tool?.title}>
								{t.arg}
							</span>
						</>
					) : (
						<span className={s.dim}>думает…</span>
					)}
					<span className={s.timer}>{timer(now - since)}</span>
				</>
			)
		}
		case 'starting':
			return <span className={s.dim}>запускается…</span>
		case 'idle':
			return <span className={s.dim}>ждёт поручения{a.queued > 0 ? ` · очередь ${a.queued}` : ''}</span>
		case 'done': {
			const sum = resultSummary(a)
			return (
				<span className={s.result} title={sum}>
					{sum || 'готово'}
				</span>
			)
		}
	}
}

export const AgentRow = memo(function AgentRow({ row, selected, now, onOpen }: AgentRowProps) {
	const { agent: a, state } = row
	const plan = planProgress(a)
	const ms = elapsedMs(a, now || Date.now())
	const step = stepText(a, state)
	const perm = a.pendingPermissions[0]
	const summary = state === 'done' ? resultSummary(a) : ''
	const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
		if (e.target !== e.currentTarget) return
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			onOpen(a.id)
		}
	}
	return (
		<div
			className={[s.row, selected && s.selected, row.flash && s.flash, row.fresh && s.fresh].filter(Boolean).join(' ')}
			data-row={a.id}
			data-state={state}
			role="row"
			tabIndex={0}
			aria-selected={selected}
			aria-label={`${a.name}, ${AGENT_STATE_LABEL[state]}, ${row.task}`}
			onClick={() => onOpen(a.id)}
			onKeyDown={onKey}
		>
			<span className={s.stripe} aria-hidden="true" />
			<span className={s.cSt} role="cell">
				<StatusIcon state={state} label={AGENT_STATE_LABEL[state]} />
			</span>
			<span className={s.cAg} role="cell">
				<span className={s.name}>
					<span className={s.nameText}>{a.name}</span>
					{row.fresh && <span className={s.newTag}>новое</span>}
				</span>
				<span className={s.role} style={cssVars({ '--rc': row.role ? roleColor(row.role.hue) : 'var(--gray-7)' })}>
					<i />
					<span>{row.role?.name ?? a.space}</span>
				</span>
			</span>
			<span className={s.cTask} role="cell" title={row.task}>
				{row.task}
			</span>
			<span className={s.cProg} role="cell">
				<PlanBar entries={a.plan?.entries ?? null} state={state} />
				<span className={s.count}>{plan ? `${plan.done}/${plan.total}` : state === 'working' || state === 'wait' ? a.turnSteps : ''}</span>
				<span className={s.step} title={step}>
					<span className={s.stepMain}>{step}</span>
					{perm && <span className={s.stepPerm}>запрос: {perm.title}</span>}
					{state === 'error' && <span className={s.stepErr}>{a.error ?? a.lastReply?.failed ?? 'ошибка'}</span>}
					{summary && <span className={s.stepRes}>{summary}</span>}
				</span>
			</span>
			<span className={s.cNow} role="cell">
				<Now a={a} state={state} now={now || Date.now()} />
			</span>
			<span className={s.cTime} role="cell">
				{ms === null ? '—' : timer(ms)}
			</span>
			<span className={s.cAct} role="cell">
				{perm ? (
					<>
						<PermissionButtons key={perm.requestId} agentId={a.id} requestId={perm.requestId} />
						<StopButton agentId={a.id} iconOnly />
					</>
				) : (
					canStop(a) && (
						<span className={s.hover}>
							<StopButton agentId={a.id} />
						</span>
					)
				)}
			</span>
		</div>
	)
})
