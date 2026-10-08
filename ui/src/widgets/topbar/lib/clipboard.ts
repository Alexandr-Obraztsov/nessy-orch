import { toast } from '@/shared/ui'

/** Скопировать текст с уведомлением. */
export async function copyText(text: string, what = 'Скопировано'): Promise<void> {
	try {
		await navigator.clipboard.writeText(text)
		toast(what, 'success', 2000)
	} catch {
		toast('Не удалось скопировать — браузер запретил доступ к буферу', 'error')
	}
}
