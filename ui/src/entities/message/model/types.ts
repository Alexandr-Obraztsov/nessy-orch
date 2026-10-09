export interface MarkdownBodyProps {
	text: string
	/** текст ещё дописывается — мягкая каретка в конце */
	streaming?: boolean
	className?: string
}

/** Источник из итогового ответа: ссылка (URL) или текстовая ссылка на код/команду. */
export type SourceChip = { kind: 'url'; label: string; href: string; host: string } | { kind: 'text'; label: string }

/** Итог ответа агента по общему формату ролей. */
export type ReplyStatus = 'DONE' | 'DONE_WITH_CONCERNS' | 'BLOCKED' | 'NEEDS_CONTEXT'

/** Ответ, разобранный для показа: текст без «Источников», источники-чипы, строка «Статус». */
export interface ParsedReply {
	body: string
	sources: SourceChip[]
	status: { code: ReplyStatus; reason: string } | null
}

export interface SourcesProps {
	sources: SourceChip[]
	className?: string
}

export interface VerdictProps {
	status: NonNullable<ParsedReply['status']>
}
