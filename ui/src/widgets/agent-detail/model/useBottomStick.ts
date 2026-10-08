/**
 * Прокрутка панели для вкладки «Чат»: при открытии вкладки — к последнему сообщению,
 * дальше держит низ, пока пользователь сам не отлистал вверх. На других вкладках не вмешивается.
 */
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

const THRESHOLD = 64

export function useBottomStick(ref: RefObject<HTMLDivElement>, active: boolean, size: number): () => void {
	const stick = useRef(true)

	useLayoutEffect(() => {
		if (!active) return
		stick.current = true
		const el = ref.current
		if (el) el.scrollTop = el.scrollHeight
	}, [active, ref])

	useLayoutEffect(() => {
		const el = ref.current
		if (active && stick.current && el) el.scrollTop = el.scrollHeight
	}, [active, size, ref])

	return useCallback(() => {
		const el = ref.current
		if (!active || !el) return
		stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD
	}, [active, ref])
}
