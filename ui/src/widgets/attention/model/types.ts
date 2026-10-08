import type { AttentionItem } from '@/entities/attention'

export interface AttentionCardProps {
	item: AttentionItem
	selected: boolean
	/** заголовок поручения, в которое входит агент */
	taskTitle: string | null
}
