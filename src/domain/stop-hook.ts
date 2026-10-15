/**
 * Хук Stop главного агента (чистая функция): единственный триггер ожидания. Когда Claude закончил ход, хук решает:
 *  - пришли ответы/вопросы агентов, а Claude ещё не получил их — вернуть его в работу со сводкой (digest);
 *  - агенты работают, а фонового ожидания нет — один раз попросить запустить его (`inbox --session S --all`);
 *  - иначе остановиться.
 * Сводка и ожидание — данные и команда оркестратора; тексты ответов агентов обезврежены в domain/digest.
 */
import type { DigestResponse } from '../../shared/types'

/** Команда фонового ожидания пачки: возвращается один раз, когда все агенты закончили (или задали вопрос). */
export const waitCommand = (session: string): string => `nessy-orch inbox --session ${session} --all --wait 1500`

/** Просьба запустить ожидание: агенты работают, а ожидания нет — иначе ответы никто не заберёт. */
export function waitReminder(working: readonly string[], session: string): string {
	return `[TClaude-Orch] Агенты ещё работают: ${working.join(', ')}. Запусти в фоне (Bash, run_in_background: true): \`${waitCommand(session)}\` — ответы придут сами одной сводкой, когда они закончат. Сам не опрашивай и не жди в этом ходе: запусти и закончи ответ.`
}

export interface StopDecision {
	/** причина «не останавливаться» (текст для Claude) или null — пусть остановится */
	reason: string | null
	/** курсор сводки, который надо подтвердить после того, как причина выведена (0 — подтверждать нечего) */
	ackCursor: number
}

export function stopDecision(d: DigestResponse, session: string, stopHookActive: boolean): StopDecision {
	const needWait = d.working.length > 0 && !d.watching
	if (d.count > 0) {
		const tail = needWait ? `\n\n${waitReminder(d.working, session)}` : ''
		return { reason: `${d.header}\n\n${d.text}${tail}`, ackCursor: d.cursor }
	}
	// ожидание просим один раз: если Claude его не запустил, повторять бесконечно нельзя
	if (needWait && !stopHookActive) return { reason: waitReminder(d.working, session), ackCursor: 0 }
	return { reason: null, ackCursor: 0 }
}
