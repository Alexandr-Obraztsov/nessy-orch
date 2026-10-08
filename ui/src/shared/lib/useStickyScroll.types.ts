import type { RefObject } from 'react'

export interface StickyScroll {
	/** прокручиваемый контейнер (onScroll вешать на него) */
	scrollRef: RefObject<HTMLDivElement>
	/** внутренний блок с содержимым — за его размером следит ResizeObserver */
	contentRef: RefObject<HTMLDivElement>
	atBottom: boolean
	/** сколько новых элементов пришло, пока пользователь был не внизу */
	unseen: number
	onScroll: () => void
	scrollToBottom: (smooth?: boolean) => void
}
