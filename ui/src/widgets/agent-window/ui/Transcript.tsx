/**
 * Чат агента в стиле Claude Code: поручение сверху, текст агента — markdown с подсветкой кода,
 * мысли свёрнуты, инструменты — компактные строки «⏺ Read  src/app.ts» (раскрываются: вход и вывод),
 * разрешения — встроенные карточки, служебное — мелко по центру. Стриминг — с мягкой кареткой;
 * автопрокрутка вниз и кнопка «К последнему», если пролистали вверх.
 */
import { memo, useMemo, useRef, useState } from 'react'
import { ToolLine, toolView } from '@/entities/agent'
import { MarkdownBody, Sources, Verdict, parseReply } from '@/entities/message'
import { PermissionButtons } from '@/features/permission'
import { timer } from '@/shared/lib/time'
import { useNow } from '@/shared/lib/useNow'
import { useOverflow } from '@/shared/lib/useOverflow'
import { YOU, nodeLabel, useStore } from '@/shared/model'
import { CodeBlock, Icon, Shimmer, Sparkle } from '@/shared/ui'
import { buildItems } from '../lib/items'
import { toolDetail } from '../lib/tool'
import type { BriefProps, ChatItem, PermissionItemProps, ToolCallProps, TranscriptProps } from '../model/types'
import { useStickToBottom } from '../model/useStickToBottom'
import s from './Transcript.module.css'

export function Transcript({ agent, stream }: TranscriptProps) {
	const items = useMemo(() => buildItems(stream.events, stream.live), [stream.events, stream.live])
	const scroller = useRef<HTMLDivElement>(null)
	const liveLen = stream.live.reduce((n, r) => n + r.text.length, 0)
	const { away, toBottom } = useStickToBottom(scroller, `${items.length}:${liveLen}:${agent.status}`, stream.ready)
	const pending = new Set(agent.pendingPermissions.map(p => p.requestId))
	const agents = useStore(st => st.agents)

	return (
		<div className={s.wrap}>
			<div ref={scroller} className={s.scroll} role="log" aria-label={`Чат агента ${agent.name}`}>
				<div className={s.feed}>
					{!stream.ready && items.length === 0 && (
						<div className={s.loading}>
							<Sparkle />
							<Shimmer>Загрузка истории…</Shimmer>
						</div>
					)}
					{stream.ready && items.length === 0 && <div className={s.system}>Событий пока нет</div>}
					{items.map(it => (
						<Item key={it.key} item={it} agentId={agent.id} pending={pending} from={it.kind === 'user' ? nodeLabel(agents, it.ev.from) : ''} />
					))}
					<Working agent={agent} />
				</div>
			</div>
			<button type="button" className={s.toBottom} data-show={away || undefined} onClick={toBottom} tabIndex={away ? 0 : -1}>
				<Icon name="arrowDown" size={14} />К последнему
			</button>
		</div>
	)
}

interface ItemProps {
	item: ChatItem
	agentId: string
	pending: Set<string>
	from: string
}

const Item = memo(function Item({ item, agentId, pending, from }: ItemProps) {
	switch (item.kind) {
		case 'brief':
			return <Brief text={item.ev.text} />
		case 'user':
			return (
				<div className={s.user} data-kind="user">
					{item.ev.from !== YOU && <div className={s.userFrom}>{from}</div>}
					<MarkdownBody text={item.ev.text} />
				</div>
			)
		case 'text':
			return <AgentText text={item.ev.text} />
		case 'thought':
			return (
				<details className={s.thought} data-kind="thought">
					<summary>
						<Icon name="chevronRight" size={12} className={s.chev} />
						Размышления
					</summary>
					<div className={s.thoughtBody}>{item.ev.text}</div>
				</details>
			)
		case 'tool':
			return <ToolCall ev={item.ev} />
		case 'permission':
			return <PermissionItem agentId={agentId} ev={item.ev} pending={pending.has(item.ev.requestId)} />
		case 'system':
			return (
				<div className={s.system} data-level={item.ev.level} data-kind="system">
					{item.ev.text}
				</div>
			)
		case 'live':
			return item.run.kind === 'thought' ? (
				<div className={s.thoughtLive} data-kind="thought">
					<Shimmer>Размышляет…</Shimmer>
				</div>
			) : (
				<div className={s.text} data-kind="text">
					<MarkdownBody text={item.run.text} streaming />
				</div>
			)
	}
})

const BRIEF_LINES = 12

/** Поручение: выделенный блок, длинное — свёрнуто с «Показать полностью». */
function Brief({ text }: BriefProps) {
	const [full, setFull] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	const over = useOverflow(ref, text)
	return (
		<section className={s.brief} data-kind="brief" aria-label="Поручение">
			<div className={s.briefLabel}>Поручение</div>
			<div ref={ref} className={s.briefBody} data-full={full || undefined} data-clipped={(over && !full) || undefined} style={{ ['--lines' as string]: BRIEF_LINES }}>
				<MarkdownBody text={text} />
			</div>
			{(over || full) && (
				<button type="button" className={s.briefMore} onClick={() => setFull(v => !v)}>
					{full ? 'Свернуть' : 'Показать полностью'}
				</button>
			)}
		</section>
	)
}

/** Текст агента: markdown; «Источники» — чипы, «Статус: …» — бейдж. */
function AgentText({ text }: { text: string }) {
	const parsed = useMemo(() => parseReply(text), [text])
	return (
		<div className={s.text} data-kind="text">
			{parsed.status && <Verdict status={parsed.status} />}
			{parsed.body && <MarkdownBody text={parsed.body} />}
			<Sources sources={parsed.sources} />
		</div>
	)
}

function toneOf(status: string): 'run' | 'ok' | 'err' {
	if (status === 'completed') return 'ok'
	if (status === 'failed') return 'err'
	return 'run'
}

/** Инструмент: строка «⏺ Bash  npm test   42 строки», по клику — вход и вывод. Ошибка раскрыта сразу. */
const ToolCall = memo(function ToolCall({ ev }: ToolCallProps) {
	const [open, setOpen] = useState<boolean | null>(null)
	const detail = useMemo(() => toolDetail(ev), [ev])
	const isOpen = open ?? ev.status === 'failed'
	const expandable = detail.input !== null || detail.output !== null
	return (
		<div className={s.tool} data-kind="tool" data-open={isOpen || undefined}>
			<button type="button" className={s.toolHead} aria-expanded={expandable ? isOpen : undefined} disabled={!expandable} onClick={() => setOpen(!isOpen)}>
				<ToolLine tool={toolView(ev)} tone={toneOf(ev.status)} aside={detail.summary} className={s.toolLine} />
				{expandable && <Icon name="chevronRight" size={12} className={s.chev} />}
			</button>
			{isOpen && expandable && (
				<div className={s.toolBody}>
					{detail.input && <CodeBlock code={detail.input.code} lang={detail.input.lang} label={detail.input.label} maxLines={30} />}
					{detail.output && (
						<CodeBlock code={detail.output.code} lang={detail.output.lang} label={detail.output.label} maxLines={20} tone={ev.status === 'failed' ? 'error' : 'plain'} />
					)}
				</div>
			)}
		</div>
	)
})

/** Запрос разрешения прямо в чате: ждёт — с кнопками; решён — строка с итогом. */
function PermissionItem({ agentId, ev, pending }: PermissionItemProps) {
	if (!ev.resolved && pending)
		return (
			<div className={s.perm} data-kind="permission" role="group" aria-label="Запрос разрешения">
				<div className={s.permTitle}>Просит разрешение</div>
				<code className={s.permCmd}>{ev.title}</code>
				<div className={s.permActs}>
					<PermissionButtons agentId={agentId} requestId={ev.requestId} />
				</div>
			</div>
		)
	const verdict = !ev.resolved ? 'снят' : ev.auto ? 'разрешено автоматически' : ev.approved ? 'разрешено' : 'отклонено'
	return (
		<div className={s.tool} data-kind="tool">
			<div className={s.toolHead}>
				<ToolLine
					tool={{ name: 'Разрешение', arg: ev.title }}
					tone={ev.resolved && ev.approved === false ? 'err' : ev.resolved ? 'ok' : 'idle'}
					aside={verdict}
					className={s.toolLine}
				/>
			</div>
		</div>
	)
}

/** Агент работает: «✻ Работает… 0:42» внизу, как в Claude Code. */
function Working({ agent }: Pick<TranscriptProps, 'agent'>) {
	const live = agent.status === 'working' || agent.status === 'starting'
	const now = useNow(live ? 1000 : 60_000)
	if (!live) return null
	const started = Date.parse(agent.turnStartedAt ?? agent.lastActivityAt)
	const waiting = agent.pendingPermissions.length > 0
	return (
		<div className={s.working} data-kind="working" aria-live="off">
			<Sparkle tone={waiting ? 'dim' : 'accent'} />
			<Shimmer>{waiting ? 'Ждёт вашего решения…' : agent.status === 'starting' ? 'Запускается…' : 'Работает…'}</Shimmer>
			{!Number.isNaN(started) && <span className={s.workingTime}>{timer(now - started)}</span>}
		</div>
	)
}
