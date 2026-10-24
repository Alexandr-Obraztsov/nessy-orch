import type { RuntimeId } from '../../shared/types'

/** Узел графа — главный оператор (человек + Claude Code). */
export const YOU = 'you'
/**
 * Человек, пишущий агенту из приложения (отличается от `you` — главного агента сессии, который ведёт разговор): ответ агента на такое
 * сообщение идёт человеку, а главному агенту — служебная копия, чтобы он знал, что происходит с его агентами.
 */
export const USER = 'user'
/** Отправитель системных записей ленты. */
export const SYSTEM = 'system'
/** Id служебной сессии фонового обучения: в ней работают агенты-сборщики, в списки и уборку она не попадает. */
export const SERVICE_SESSION = 'background'
/** Палитра пространств (hue). */
export const PALETTE: readonly number[] = [210, 28, 150, 285, 340, 175, 55, 250]

/** Рантаймы агентов/пространств (порядок — для вывода по умолчанию); тип — единый из shared/types/domain.ts. */
export const RUNTIME_IDS: readonly RuntimeId[] = ['nessy-sdk', 'tclaude']

/** Строгая проверка: значение — известный рантайм. */
export function isRuntimeId(v: unknown): v is RuntimeId {
	return typeof v === 'string' && (RUNTIME_IDS as readonly string[]).includes(v)
}
