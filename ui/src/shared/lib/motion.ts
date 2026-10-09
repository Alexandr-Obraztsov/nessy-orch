/** Пользователь просит меньше движения: JS-анимации (FLIP-переезды) тоже выключаем. */
export function reducedMotion(): boolean {
	return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
