import type { Message } from '@contract'
import type { FeedFilter } from '@/shared/model'
import type { FilterOption } from '../model/types'

export const FILTERS: FilterOption[] = [
	{ id: 'all', label: 'Все', hint: 'Все сообщения и события' },
	{ id: 'you', label: 'Мои', hint: 'Переписка с вами' },
	{ id: 'agents', label: 'Агенты', hint: 'Сообщения между агентами' },
	{ id: 'system', label: 'Система', hint: 'Системные события' },
]

const isAgent = (id: string): boolean => id !== 'you' && id !== 'system'

export function matchFilter(m: Message, f: FeedFilter): boolean {
	switch (f) {
		case 'all':
			return true
		case 'you':
			return m.kind !== 'event' && (m.from === 'you' || m.to === 'you')
		case 'agents':
			return m.kind !== 'event' && isAgent(m.from) && isAgent(m.to)
		case 'system':
			return m.kind === 'event'
	}
}
