/** Внутренние типы оболочки (без Electron — их используют и чистые модули, и тесты). */

export interface SseFrame {
	event: string
	data: string
	id: string | null
}

export interface Point {
	x: number
	y: number
}

export interface Size {
	width: number
	height: number
}

export interface Rect extends Point, Size {}

/** Сохранённые размер и позиция главного окна. */
export interface WindowState extends Rect {
	maximized: boolean
}

export type ThemeSetting = 'system' | 'light' | 'dark'
/** Значок в Dock: только пока открыто главное окно, всегда или никогда. */
export type DockSetting = 'auto' | 'always' | 'never'

export interface Settings {
	theme: ThemeSetting
	dock: DockSetting
	notifications: boolean
	openAtLogin: boolean
	/** каталог собранного nessy-orch (с dist/src/app.js); null — встроенный или репозиторий рядом */
	serverRoot: string | null
}

/** Что решил трекер: какое уведомление показать или убрать. */
export type NotifyIntent =
	| { kind: 'permission'; agentId: string; requestId: string; title: string }
	| { kind: 'permission_resolved'; agentId: string; requestId: string }
	| { kind: 'done'; agentId: string }
	| { kind: 'error'; agentId: string; error: string }

/** Готовое уведомление (текст уже собран). */
export interface NotificationSpec {
	/** ключ дедупликации и id нативного уведомления */
	id: string
	title: string
	subtitle: string
	body: string
	/** query главного окна по клику: '?task=..&agent=..' */
	query: string
	/** кнопки «Разрешить / Отклонить» */
	permission: { agentId: string; requestId: string } | null
}

/** Ответ на пробу порта оркестратора. */
export type ProbeResult =
	| { kind: 'free' }
	| { kind: 'ours'; version: string; pid: number }
	| { kind: 'foreign'; detail: string }

/** Сырой результат HTTP-пробы (для чистого классификатора). */
export interface ProbeRaw {
	errorCode: string | null
	statusCode: number | null
	body: string
}

/** Состояние оркестратора с точки зрения приложения. */
export type HostState =
	| { kind: 'starting' }
	/** сервер поднят внутри этого процесса */
	| { kind: 'embedded'; url: string }
	/** порт уже занят нашим оркестратором (CLI, launchd) — подключились к нему */
	| { kind: 'attached'; url: string; version: string; pid: number }
	| { kind: 'error'; title: string; detail: string }

/** Сводка для строки меню. */
export interface TrayStatus {
	working: number
	waiting: number
	agents: number
}
