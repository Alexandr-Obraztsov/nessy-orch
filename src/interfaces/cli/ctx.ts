/**
 * Контекст выполнения команды: транспорт + ввод-вывод + окружение.
 * Вынесен отдельно, чтобы команды были чистыми функциями над контекстом (тестируются без реального демона).
 */
import type { Parsed } from './args.types'
import type { Transport } from './transport'

export interface Ctx {
	t: Transport
	/** флаги и позиционные аргументы команды (уже разобраны по её спецификации) */
	p: Parsed
	/** текущий каталог вызывающего (для --space по умолчанию) */
	cwd: string
	/** окружение процесса (ORCH_PORT, NESSY_ORCH_TOKEN, …) */
	env: NodeJS.ProcessEnv
	/** полезный результат — в stdout */
	out: (s: string) => void
	/** служебное — в stderr */
	info: (s: string) => void
	/** машинный вывод (--json) — в stdout */
	json: (v: unknown) => void
}
