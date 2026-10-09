export interface StopButtonProps {
	agentId: string
	size?: 'sm' | 'lg'
	/** только иконка (подпись — в title/aria-label) */
	iconOnly?: boolean
	className?: string
}

export interface StopModel {
	/** первый клик «взводит» кнопку, второй — останавливает */
	armed: boolean
	busy: boolean
	press: () => void
}
