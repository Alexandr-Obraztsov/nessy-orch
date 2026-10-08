/**
 * Набор иконок (stroke, 24×24, currentColor). Один компонент — без внешних зависимостей.
 */
import type { SVGProps } from 'react'

const PATHS = {
	plus: 'M12 5v14M5 12h14',
	send: 'M5 12h13M13 6l6 6-6 6',
	close: 'M6 6l12 12M18 6L6 18',
	stop: 'M7 7h10v10H7z',
	trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
	folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
	graph: 'M12 12m-2.5 0a2.5 2.5 0 105 0a2.5 2.5 0 10-5 0M5 5m-2 0a2 2 0 104 0a2 2 0 10-4 0M19 6m-2 0a2 2 0 104 0a2 2 0 10-4 0M18 19m-2 0a2 2 0 104 0a2 2 0 10-4 0M6.5 6.5l3.6 3.6M17.3 7.2l-3.4 3.2M16.6 17.4l-2.8-3.6',
	chat: 'M4 5h16v11H9l-5 4z',
	feed: 'M5 6h14M5 12h14M5 18h9',
	bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
	check: 'M5 12.5l4.5 4.5L19 7',
	x: 'M7 7l10 10M17 7L7 17',
	tool: 'M14.5 6.5a4 4 0 00-5.6 5.1L4 16.5 7.5 20l4.9-4.9a4 4 0 005.1-5.6l-2.6 2.6-2.4-.6-.6-2.4z',
	brain: 'M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 0V4.5A2.5 2.5 0 009 4zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-6 0',
	alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
	info: 'M12 8v.5M12 11v6M12 21a9 9 0 100-18 9 9 0 000 18z',
	shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z',
	chevronDown: 'M6 9l6 6 6-6',
	chevronLeft: 'M15 6l-6 6 6 6',
	chevronRight: 'M9 6l6 6-6 6',
	arrowDown: 'M12 5v14M6 13l6 6 6-6',
	sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
	moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
	search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
	copy: 'M9 9h10v10H9zM5 15V5h10',
	reply: 'M10 8L5 12l5 4M5 12h9a5 5 0 015 5v1',
	target: 'M12 12m-8 0a8 8 0 1016 0a8 8 0 10-16 0M12 12m-3 0a3 3 0 106 0a3 3 0 10-6 0',
	zoomIn: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4M8 11h6M11 8v6',
	zoomOut: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4M8 11h6',
	user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
	terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
	file: 'M7 3h7l5 5v13H7zM14 3v5h5',
	pulse: 'M3 12h4l3-8 4 16 3-8h4',
	more: 'M5 12h.01M12 12h.01M19 12h.01',
	/* «⋯» потолще — для меню действий */
	dots: 'M5 12m-1.2 0a1.2 1.2 0 102.4 0a1.2 1.2 0 10-2.4 0M12 12m-1.2 0a1.2 1.2 0 102.4 0a1.2 1.2 0 10-2.4 0M19 12m-1.2 0a1.2 1.2 0 102.4 0a1.2 1.2 0 10-2.4 0',
	clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
	wifiOff: 'M3 3l18 18M8.5 16.4a5 5 0 017 0M5 12.9a10 10 0 013.9-2.4M19 12.9a10 10 0 00-4-2.5M2 9.3a15 15 0 014.7-2.9M22 9.3a15 15 0 00-9.4-3.3M12 20h.01',
	layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
	link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
	refresh: 'M20 11a8 8 0 00-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0014.3 4.9L20 16M20 20v-4h-4',
	menu: 'M4 7h16M4 12h16M4 17h16',
	users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20a6.5 6.5 0 0113 0M16 4.3a3.5 3.5 0 010 6.4M18 14a6.5 6.5 0 013.5 6',
} as const

export type IconName = keyof typeof PATHS

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
	name: IconName
	size?: number
}

export function Icon({ name, size = 18, strokeWidth = 1.8, ...rest }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...rest}
		>
			<path d={PATHS[name]} />
		</svg>
	)
}
