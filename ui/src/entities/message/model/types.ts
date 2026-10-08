import type { ReactNode } from 'react'

export interface MarkdownBodyProps {
	text: string
	/** свернуть, если выше этого (px); 0 — не сворачивать */
	collapseAt?: number
	/** markdown на акцентном фоне (свои сообщения) */
	onAccent?: boolean
	className?: string
}

export type BubbleSide = 'in' | 'out'
export type BubbleTone = 'default' | 'failed'

export interface BubbleProps {
	side: BubbleSide
	tone?: BubbleTone
	/** первый пузырь группы — с «хвостиком» */
	tail?: boolean
	/** строка над текстом: отправитель → получатель */
	head?: ReactNode
	/** подвал: время, значки состояния */
	meta?: ReactNode
	/** анимировать появление */
	enter?: boolean
	children: ReactNode
}

export interface SystemPillProps {
	level?: 'info' | 'error'
	time?: string
	enter?: boolean
	children: ReactNode
}

export interface CollapseState {
	ref: (el: HTMLDivElement | null) => void
	/** контент выше лимита */
	overflow: boolean
	expanded: boolean
	toggle: () => void
}
