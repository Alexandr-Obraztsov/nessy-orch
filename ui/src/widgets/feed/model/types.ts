import type { Message } from '@contract'
import type { FeedFilter } from '@/shared/model'

export type FeedRow =
	| { t: 'day'; key: string; label: string }
	| { t: 'event'; key: string; msg: Message }
	| {
			t: 'msg'
			key: string
			msg: Message
			/** первое сообщение группы (аватар, имя, «хвостик») */
			first: boolean
			/** показывать строку маршрута «кто → кому» */
			route: boolean
			/** отправитель ждёт ответ, а ответа ещё нет */
			waiting: boolean
			/** текст исходного сообщения для ответа (цитата) */
			quote: string | null
	  }

export interface FilterOption {
	id: FeedFilter
	label: string
	hint: string
}
