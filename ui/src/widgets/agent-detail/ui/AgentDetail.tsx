/**
 * Детали агента (правая колонка; на средних экранах — выезжающая панель, на узких — весь экран):
 * шапка, баннер «ждёт вас», «Сейчас», «План», вкладки «Результат / Шаги / Чат», поле ввода.
 */
import { useMemo, useRef } from 'react'
import { Composer } from '@/features/compose-message'
import { useAgentStream } from '@/entities/agent'
import { useNow } from '@/shared/lib/useNow'
import { useStore } from '@/shared/model'
import { Icon } from '@/shared/ui'
import { attentionOf, defaultTab } from '../lib/attention'
import { lastTurn } from '../lib/turn'
import { markSeen, useSeen } from '../model/seen'
import { useTabMemory } from '../model/tabMemory'
import type { AgentDetailProps, CloseProps, DetailTab, DetailViewProps, StepsPaneProps } from '../model/types'
import { useBottomStick } from '../model/useBottomStick'
import { useResultText } from '../model/useResultText'
import { useRetry } from '../model/useRetry'
import { useToolDurations } from '../model/useToolDurations'
import s from './AgentDetail.module.css'
import { AttentionBanner } from './AttentionBanner'
import { ChatTab } from './ChatTab'
import { DetailHeader } from './DetailHeader'
import { NowBlock } from './NowBlock'
import { PlanBlock } from './PlanBlock'
import { ResultTab } from './ResultTab'
import { StepsTab } from './StepsTab'

export function AgentDetail({ agentId, onClose }: AgentDetailProps) {
	// key — при смене агента сбрасываем всё локальное (прокрутка, раскрытия, черновик)
	return <DetailRoot key={agentId} agentId={agentId} onClose={onClose} />
}

function DetailRoot({ agentId, onClose }: AgentDetailProps) {
	const stream = useAgentStream(agentId)
	const stored = useStore(st => st.agents.find(a => a.id === agentId))
	const conn = useStore(st => st.conn)
	const agent = stored ?? (conn === 'live' ? null : stream.agent)

	if (!agent)
		return (
			<section className={s.panel} aria-label="Детали агента">
				{conn === 'live' ? <NotFound id={agentId} onClose={onClose} /> : <Loading onClose={onClose} />}
			</section>
		)
	return <Detail agent={agent} stream={stream} onClose={onClose} />
}

const TABS: { id: DetailTab; label: string }[] = [
	{ id: 'result', label: 'Результат' },
	{ id: 'steps', label: 'Шаги' },
	{ id: 'chat', label: 'Чат' },
]

function Detail({ agent, stream, onClose }: DetailViewProps) {
	const scroll = useRef<HTMLDivElement>(null)
	const [chosen, choose] = useTabMemory(agent.id)
	const tab = chosen ?? defaultTab(agent)
	const seen = useSeen()
	const attention = attentionOf(agent, seen)
	const retry = useRetry(agent, stream.events)
	const resultText = useResultText(agent, stream.events)
	const durations = useToolDurations(stream.events, stream.ready)
	const working = agent.status === 'working' || agent.status === 'starting'

	const counts = useMemo(
		() => ({
			steps: lastTurn(stream.events, durations, false, 0)?.steps.length ?? 0,
			chat: stream.events.filter(e => e.kind === 'user' || e.kind === 'text').length,
		}),
		[stream.events, durations],
	)
	const liveSize = stream.live.reduce((n, r) => n + r.text.length, 0)
	const onScroll = useBottomStick(scroll, tab === 'chat' && stream.ready, stream.events.length + liveSize)

	const openTab = (t: DetailTab): void => {
		choose(t)
		if (t !== 'chat') scroll.current?.querySelector('[data-tabs]')?.scrollIntoView({ block: 'nearest' })
	}

	return (
		<section className={s.panel} aria-label={`Детали агента ${agent.name}`} data-agent-detail={agent.id}>
			<DetailHeader agent={agent} onClose={onClose} />
			<div className={s.scroll} ref={scroll} onScroll={onScroll}>
				{attention && (
					<div className={s.bannerWrap}>
						<AttentionBanner
							agent={agent}
							attention={attention}
							onRetry={retry}
							onSeen={markSeen}
							onOpenResult={() => openTab('result')}
							resultShown={tab === 'result'}
						/>
					</div>
				)}
				<NowBlock agent={agent} events={stream.events} live={stream.live} />
				<PlanBlock agent={agent} />
				<div className={s.tabs} role="tablist" aria-label="Разделы" data-tabs="">
					{TABS.map(x => (
						<button
							key={x.id}
							type="button"
							role="tab"
							id={`detail-tab-${x.id}`}
							aria-selected={tab === x.id}
							aria-controls="detail-tabpanel"
							className={s.tab}
							onClick={() => openTab(x.id)}
						>
							{x.label}
							{x.id === 'result' && agent.lastReply?.failed && <span className={s.tabErr} aria-label="ошибка" />}
							{x.id !== 'result' && counts[x.id] > 0 && <span className={s.tabCount}>{counts[x.id]}</span>}
						</button>
					))}
				</div>
				<div className={s.tabBody} role="tabpanel" id="detail-tabpanel" aria-labelledby={`detail-tab-${tab}`}>
					{tab === 'result' && <ResultTab agent={agent} text={resultText} />}
					{tab === 'steps' && <StepsPane agent={agent} stream={stream} durations={durations} running={working} />}
					{tab === 'chat' && <ChatTab agent={agent} events={stream.events} live={stream.live} ready={stream.ready} durations={durations} />}
				</div>
			</div>
			<div className={s.composer}>
				<Composer key={agent.id} to={agent.id} interruptToggle onSent={() => tab === 'chat' && scroll.current?.scrollTo({ top: scroll.current.scrollHeight })} />
			</div>
		</section>
	)
}

/** «Шаги» с живыми длительностями: тикает раз в секунду только пока ход идёт. */
function StepsPane({ agent, stream, durations, running }: StepsPaneProps) {
	const now = useNow(running ? 1000 : 60_000)
	const turn = useMemo(() => lastTurn(stream.events, durations, running, now), [stream.events, durations, running, now])
	if (!stream.ready) return <div className={s.empty}>Загрузка шагов…</div>
	return <StepsTab agent={agent} turn={turn} />
}

function NotFound({ id, onClose }: CloseProps & { id: string }) {
	return (
		<div className={s.notFound}>
			<Icon name="user" size={28} className={s.nfIcon} />
			<p className={s.nfText}>
				Агента <code>{id}</code> больше нет — его удалили. Сообщения остались в журнале.
			</p>
			<button type="button" className={s.ghostBtn} onClick={onClose}>
				<Icon name="close" size={13} />
				Закрыть
			</button>
		</div>
	)
}

function Loading({ onClose }: CloseProps) {
	return (
		<>
			<div className={s.loadHead}>
				<span className={s.loadBar} />
				<button type="button" className={s.ghostBtn} onClick={onClose} aria-label="Закрыть">
					<Icon name="close" size={13} />
				</button>
			</div>
			<div className={s.skeleton} aria-busy="true" aria-label="Загрузка">
				<i style={{ width: '60%' }} />
				<i style={{ width: '90%', height: 60 }} />
				<i style={{ width: '70%', height: 14 }} />
			</div>
		</>
	)
}
