import type { AgentIdentity, PeerInfo, RoleBrief } from './types'

function peerLabel(p: PeerInfo): string {
	const extra = [p.id, p.space, ...(p.roleName ? [`роль ${p.roleName}`] : [])].join(', ')
	return `${p.name} (${extra})${p.archived ? ' — в архиве, напиши — проснётся' : ''}`
}

/** Вводная для нового контекста агента: кто он, кто рядом, как писать другим и (если есть) его роль. */
export function buildPreamble(agent: AgentIdentity, peers: readonly PeerInfo[], cli: string, role: RoleBrief | null = null): string {
	const lines = [
		`[nessy-orch] Ты — агент «${agent.name}» (id: ${agent.id}) в оркестраторе, пространство «${agent.space}».`,
		`Сообщения тебе приходят от оператора (you) или от других агентов; твой финальный ответ уходит отправителю автоматически.`,
		`Чтобы САМОСТОЯТЕЛЬНО написать другому агенту или оператору, выполни в shell:`,
		`  ${cli} send --from ${agent.id} <кому> "текст"        # асинхронно, ответ придёт тебе сообщением`,
		`  ${cli} send --from ${agent.id} --wait <кому> "текст" # дождаться ответа прямо в выводе команды`,
		`<кому> — id или имя агента, либо «you». Не пересылай сообщения без необходимости: цепочки ограничены.`,
		`Если в задаче больше 2 шагов — в начале опубликуй план и обновляй его по ходу (каждый раз список целиком, коротко):`,
		`  ${cli} plan --from ${agent.id} "- [x] сделано" "- [~] в работе" "- [ ] впереди"`,
	]
	lines.push(peers.length ? `Другие агенты: ${peers.map(peerLabel).join('; ')}.` : 'Других агентов пока нет.')
	if (role) lines.push('', `Твоя роль: ${role.name}`, role.instructions.trim())
	return lines.join('\n')
}
