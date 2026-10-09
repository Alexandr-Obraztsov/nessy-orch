import { toast } from '@/shared/ui'

/** Скопировать текст в буфер обмена с всплывашкой об итоге. */
export async function copyText(text: string, what = 'Скопировано'): Promise<void> {
	try {
		await navigator.clipboard.writeText(text)
		toast(what, 'success', 1800)
	} catch {
		toast('Буфер обмена недоступен', 'error')
	}
}
