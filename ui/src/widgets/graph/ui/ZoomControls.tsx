/** Кнопки масштаба: +, −, вписать (вписать подсвечена, когда вид следует за графом). */
import { Icon } from '@/shared/ui'
import o from './Overlays.module.css'

export interface ZoomControlsProps {
	onZoom: (f: number) => void
	onFit: () => void
	follow: boolean
}

export function ZoomControls({ onZoom, onFit, follow }: ZoomControlsProps) {
	return (
		<div className={`${o.zoom} ${o.glass}`} role="toolbar" aria-label="Масштаб графа">
			<button type="button" className={o.zoomBtn} onClick={() => onZoom(1.3)} aria-label="Приблизить" title="Приблизить">
				<Icon name="zoomIn" size={16} />
			</button>
			<button type="button" className={o.zoomBtn} onClick={() => onZoom(1 / 1.3)} aria-label="Отдалить" title="Отдалить">
				<Icon name="zoomOut" size={16} />
			</button>
			<span className={o.zoomSep} />
			<button
				type="button"
				className={`${o.zoomBtn} ${follow ? o.zoomBtnOn : ''}`}
				onClick={onFit}
				aria-label="Вписать граф"
				aria-pressed={follow}
				title="Вписать граф"
			>
				<Icon name="target" size={16} />
			</button>
		</div>
	)
}
