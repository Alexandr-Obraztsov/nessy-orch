/** Где показать поповер: под иконкой строки меню, по центру иконки, не вылезая за экран. */
import type { Point, Rect, Size } from '../types'

const GAP = 6
const MARGIN = 8

/**
 * tray — границы иконки (на macOS сверху экрана), work — рабочая область экрана с иконкой.
 * Если границы иконки неизвестны (нулевые), прижимаем к правому верхнему углу у курсора.
 */
export function popoverPosition(tray: Rect, size: Size, work: Rect, cursor: Point | null = null): Point {
	const known = tray.width > 0 && tray.height > 0
	const anchorX = known ? tray.x + tray.width / 2 : (cursor?.x ?? work.x + work.width - size.width / 2 - MARGIN)
	let x = Math.round(anchorX - size.width / 2)
	const minX = work.x + MARGIN
	const maxX = work.x + work.width - size.width - MARGIN
	x = Math.min(Math.max(x, minX), Math.max(minX, maxX))

	let y: number
	const trayBelowWork = known && tray.y >= work.y + work.height - 1
	if (trayBelowWork) {
		// панель снизу (Windows/Linux): над иконкой
		y = Math.round(tray.y - size.height - GAP)
	} else {
		y = Math.round(known ? Math.max(tray.y + tray.height, work.y) + GAP : work.y + GAP)
	}
	const maxY = work.y + work.height - size.height
	y = Math.min(Math.max(y, work.y), Math.max(work.y, maxY))
	return { x, y }
}
