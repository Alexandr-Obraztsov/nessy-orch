/**
 * Каналы IPC между preload и main. Preload работает в песочнице и не может импортировать
 * локальные модули, поэтому дублирует эти строки; тест проверяет, что они совпадают.
 */
export const IPC = {
	openMain: 'nessy:open-main',
	hidePopover: 'nessy:hide-popover',
	retry: 'nessy:retry',
	quit: 'nessy:quit',
	status: 'nessy:status',
} as const

/** Аргументы командной строки рендерера (webPreferences.additionalArguments). */
export const ARG_MODE = '--nessy-mode='
export const ARG_URL = '--nessy-url='
