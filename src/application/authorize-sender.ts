/**
 * Проверка «от чьего имени» вызов: оператор (токен) может всё; без токена — только от имени агента с его ключом
 * (`--from <агент> --key <ключ>`), иначе агент мог бы выдать себя за оператора или за другого агента.
 * Выделено из orchestrator.ts по единой ответственности — «авторизация отправителя».
 */
import * as crypto from 'node:crypto'
import { USER, YOU } from '../domain/constants'
import { AppError } from '../domain/errors'
import type { Registry } from './registry'

/** Кто зовёт: оператор (токен) или агент с ключом. */
export interface SenderCaller {
	operator: boolean
	agentKey: string | null
}

/** Проверка: оператор может всё; агент — только от своего имени с верным ключом. 403 operator_required / bad_agent_key. */
export function checkSender(registry: Registry, from: string | undefined, caller: SenderCaller): void {
	if (caller.operator) return
	if (!from || from === YOU || from === USER)
		throw new AppError(
			403,
			'operator_required',
			'от имени оператора можно только с токеном; агент пишет от своего имени: --from <свой id> --key <ключ из вводной>',
		)
	const agent = registry.resolveAgent(from)
	const a = Buffer.from(agent.key)
	const b = Buffer.from(caller.agentKey ?? '')
	if (a.length === 0 || a.length !== b.length || !crypto.timingSafeEqual(a, b))
		throw new AppError(403, 'bad_agent_key', `ключ агента ${agent.id} не подошёл: возьми --key из своей вводной`)
}
