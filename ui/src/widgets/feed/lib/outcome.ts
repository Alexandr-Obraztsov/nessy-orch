import type { Message } from '@contract'
import type { ReplyOutcome } from '../model/types'

/** Итог хода по ответу агента (для значка ✓ / ✗ / прерван). */
export function replyOutcome(m: Message): ReplyOutcome {
	if (m.kind !== 'reply') return 'message'
	if (m.failed) return 'failed'
	if (m.text.trim() === '(ход прерван)') return 'interrupted'
	return 'ok'
}
