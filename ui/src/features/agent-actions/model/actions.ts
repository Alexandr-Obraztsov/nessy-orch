/** Действия над агентом: прервать ход, архив, возврат, удаление, копирование. Ошибки — тостом. */
import { api, errorText } from '@/shared/api'
import { closeAgent, getView } from '@/shared/model'
import { toast } from '@/shared/ui'

export async function cancelTurn(id: string): Promise<boolean> {
	try {
		await api.cancel(id)
		toast('Ход прерван', 'success')
		return true
	} catch (e) {
		toast(`Не удалось прервать: ${errorText(e)}`, 'error')
		return false
	}
}

export async function archiveAgent(id: string, name: string): Promise<boolean> {
	try {
		await api.archive(id)
		toast(`${name} — в архиве`, 'success', 2400)
		return true
	} catch (e) {
		toast(`Не удалось архивировать: ${errorText(e)}`, 'error')
		return false
	}
}

export async function restoreAgent(id: string, name: string): Promise<boolean> {
	try {
		await api.restore(id)
		toast(`${name} возвращён из архива`, 'success', 2400)
		return true
	} catch (e) {
		toast(`Не удалось вернуть: ${errorText(e)}`, 'error')
		return false
	}
}

export async function removeAgent(id: string, name: string): Promise<boolean> {
	try {
		await api.removeAgent(id)
		if (getView().selectedAgentId === id) closeAgent()
		toast(`Агент ${name} удалён`, 'success')
		return true
	} catch (e) {
		toast(`Не удалось удалить: ${errorText(e)}`, 'error')
		return false
	}
}

export async function copyText(text: string, what = 'Скопировано'): Promise<void> {
	try {
		await navigator.clipboard.writeText(text)
		toast(what, 'success', 1800)
	} catch {
		toast('Буфер обмена недоступен', 'error')
	}
}
