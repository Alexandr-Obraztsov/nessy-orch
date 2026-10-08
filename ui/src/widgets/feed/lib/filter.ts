import type { Message } from '@contract'
import type { FeedOptions } from '@/shared/model'

/**
 * Что видно в ленте. По умолчанию — только ваши сообщения и то, что агенты адресовали вам
 * (итоговые ответы и сообщения). Переписка агентов и системные события — по переключателям.
 */
export function visibleInFeed(m: Message, opts: FeedOptions): boolean {
	if (m.kind === 'event') return opts.system
	if (m.from === 'you' || m.to === 'you') return true
	return opts.agentChatter
}
