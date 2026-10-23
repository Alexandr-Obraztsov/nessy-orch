/** Общие константы повторов обращения к nessy (подключение и ход). */
/** повторы промпта при временном отказе nessy: сколько раз и пауза */
export const PROMPT_RETRY_MAX = 5
export const PROMPT_RETRY_BASE_MS = 1000
export const PROMPT_RETRY_MAX_DELAY_MS = 30000
/** повторы создания/подъёма сессии, пока у демона нет места (лимит сессий) */
export const SESSION_RETRY_MAX = 12
