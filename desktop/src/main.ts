/**
 * Главный процесс приложения nessy для macOS. Один процесс: оркестратор (собранный сервер nessy-orch)
 * работает прямо здесь, на 127.0.0.1:4337, — CLI `nessy-orch` ходит на тот же адрес. Окна показывают
 * наш React-UI с этого сервера. Иконка ✻ живёт в строке меню; закрытие окна приложение не завершает,
 * «Выйти» останавливает всё.
 */
import { app, globalShortcut, ipcMain, Menu, nativeTheme, type IpcMainEvent, type MenuItemConstructorOptions } from 'electron'
import * as path from 'node:path'
import { getRaw, postJson } from './lib/http'
import { IPC } from './lib/ipc'
import { applyLoginEnv } from './lib/login-env'
import { AgentTracker } from './lib/notify-policy'
import { classifyProbe } from './lib/probe'
import { loadServerModules, ServerHost } from './lib/server-host'
import { dockVisible, parseSettings } from './lib/settings'
import { StreamClient } from './lib/stream-client'
import { trayStatus } from './lib/tray-state'
import { sameOrigin, sanitizeQuery } from './lib/urls'
import { parseWindowState } from './lib/window-state'
import { serverRoot, trayFrames } from './electron/assets'
import { MainWindow } from './electron/main-window'
import { Notifier } from './electron/notifier'
import { Popover } from './electron/popover'
import { JsonFile } from './electron/store'
import type { View } from './electron/surface'
import { StatusTray } from './electron/tray'
import type { DockSetting, HostState, Settings, ThemeSetting } from './types'

const SHORTCUT = 'Alt+Command+N'
const log = (msg: string): void => console.log('[nessy-desktop] ' + msg)

if (!app.requestSingleInstanceLock()) {
	app.quit()
} else {
	start()
}

function start(): void {
	app.setName('nessy')
	const userData = app.getPath('userData')
	const settingsFile = new JsonFile<Settings>(path.join(userData, 'settings.json'), parseSettings)
	const windowFile = new JsonFile(path.join(userData, 'window-state.json'), parseWindowState)
	let settings = settingsFile.read()
	const saveSettings = (patch: Partial<Settings>): void => {
		settings = { ...settings, ...patch }
		settingsFile.write(settings, 0)
	}

	const tracker = new AgentTracker()
	const preload = path.join(__dirname, 'preload.js')
	let online = false
	let stream: StreamClient | null = null
	let tray: StatusTray | null = null
	let quitting = false
	let stopped = false

	const host = new ServerHost({
		root: serverRoot(settings.serverRoot),
		env: process.env,
		load: loadServerModules,
		probe: async url => classifyProbe(await getRaw(url)),
		onState: s => onHostState(s),
		log,
	})

	const view = (): View => {
		const s = host.state
		if ((s.kind === 'embedded' || s.kind === 'attached') && online) return { kind: 'ui', base: s.url }
		if (s.kind === 'error') return { kind: 'status', status: { state: 'error', title: s.title, detail: s.detail } }
		return { kind: 'status', status: { state: 'starting', title: 'Запускаю оркестратор…', detail: s.kind === 'starting' ? 'Читаю окружение терминала и поднимаю сервер' : 'Подключаюсь к потоку событий' } }
	}

	const updateDock = (): void => {
		if (process.platform !== 'darwin' || !app.dock) return
		if (dockVisible(settings.dock, mainWindow.isOpen)) void app.dock.show()
		else app.dock.hide()
	}

	const mainWindow = new MainWindow({
		preload,
		base: () => host.baseUrl,
		view,
		stateFile: windowFile,
		onOpenChange: () => updateDock(),
		onLoadFailed: () => {
			online = false
			render()
			void host.ensure()
		},
	})
	const popover = new Popover({ preload, base: () => host.baseUrl, view })

	const render = (): void => {
		mainWindow.render()
		popover.render()
		refreshTray()
	}

	const refreshTray = (): void => tray?.update(trayStatus(tracker.list()), !online)

	const notifier = new Notifier({
		tracker,
		enabled: () => settings.notifications,
		appFocused: () => mainWindow.isFocused || popover.isFocused,
		openMain: q => {
			popover.hide()
			mainWindow.open(q)
		},
		resolvePermission: async (agentId, requestId, approve) => {
			const url = `${host.baseUrl}/agents/${encodeURIComponent(agentId)}/permission/${encodeURIComponent(requestId)}`
			return (await postJson(url, { approve })) === 200
		},
		log,
	})

	function onHostState(s: HostState): void {
		log('оркестратор: ' + s.kind)
		if (s.kind === 'embedded' || s.kind === 'attached') connectStream(s.url)
		else {
			online = false
			stream?.stop()
			stream = null
		}
		render()
	}

	function connectStream(base: string): void {
		stream?.stop()
		let failures = 0
		stream = new StreamClient(base + '/stream', {
			onOpen: () => {
				failures = 0
			},
			onEvent: evt => {
				const intents = tracker.apply(evt)
				if (evt.t === 'snapshot' && !online) {
					online = true
					render()
				}
				notifier.handle(intents)
				if (evt.t === 'snapshot' || evt.t === 'agent' || evt.t === 'agent_removed') refreshTray()
			},
			onClose: () => {
				tracker.disconnect()
				if (online) {
					online = false
					refreshTray()
				}
				// внешний оркестратор пропал (порт свободен) — поднимем свой
				if (++failures >= 2 && host.state.kind === 'attached' && !quitting)
					void getRaw(host.baseUrl + '/status').then(r => {
						if (classifyProbe(r).kind === 'free' && host.state.kind === 'attached') void host.ensure()
					})
			},
		})
		stream.start()
	}

	const setTheme = (theme: ThemeSetting): void => {
		nativeTheme.themeSource = theme
		saveSettings({ theme })
	}
	const setDock = (dock: DockSetting): void => {
		saveSettings({ dock })
		updateDock()
	}
	const setOpenAtLogin = (openAtLogin: boolean): void => {
		app.setLoginItemSettings({ openAtLogin })
		saveSettings({ openAtLogin })
	}

	const restartServer = async (): Promise<void> => {
		online = false
		render()
		await host.restart()
		mainWindow.reload()
		popover.reload()
	}

	const trayMenu = (): Menu => {
		const s = trayStatus(tracker.list())
		const hs = host.state
		const statusLine =
			hs.kind === 'error'
				? 'Оркестратор: ошибка'
				: !online
					? 'Оркестратор запускается…'
					: `Агентов в работе: ${s.working}${s.waiting ? ` · ждут разрешения: ${s.waiting}` : ''}`
		const serverItem: MenuItemConstructorOptions =
			hs.kind === 'attached'
				? { label: `Оркестратор запущен отдельно (pid ${hs.pid})`, enabled: false }
				: hs.kind === 'error'
					? { label: 'Повторить запуск оркестратора', click: () => void host.ensure() }
					: { label: 'Перезапустить оркестратор', enabled: hs.kind === 'embedded', click: () => void restartServer() }
		const radio = <T extends string>(label: string, value: T, current: T, set: (v: T) => void): MenuItemConstructorOptions => ({
			label,
			type: 'radio',
			checked: value === current,
			click: () => set(value),
		})
		return Menu.buildFromTemplate([
			{ label: statusLine, enabled: false },
			{ type: 'separator' },
			{ label: 'Открыть nessy', click: () => mainWindow.open() },
			{ label: 'Поповер', accelerator: SHORTCUT, click: () => popover.toggle(tray?.bounds ?? null) },
			{ type: 'separator' },
			serverItem,
			{
				label: 'Тема',
				submenu: [
					radio('Системная', 'system', settings.theme, setTheme),
					radio('Светлая', 'light', settings.theme, setTheme),
					radio('Тёмная', 'dark', settings.theme, setTheme),
				],
			},
			{
				label: 'Значок в Dock',
				submenu: [
					radio('Пока открыто окно', 'auto', settings.dock, setDock),
					radio('Всегда', 'always', settings.dock, setDock),
					radio('Никогда', 'never', settings.dock, setDock),
				],
			},
			{ label: 'Уведомления', type: 'checkbox', checked: settings.notifications, click: i => saveSettings({ notifications: i.checked }) },
			{ label: 'Запускать при входе', type: 'checkbox', checked: settings.openAtLogin, click: i => setOpenAtLogin(i.checked) },
			{ type: 'separator' },
			{ label: 'Выйти', accelerator: 'Command+Q', click: () => app.quit() },
		])
	}

	const appMenu = (): Menu =>
		Menu.buildFromTemplate([
			{ role: 'appMenu' },
			{ role: 'editMenu' },
			{
				label: 'Вид',
				submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
			},
			{ role: 'windowMenu' },
		])

	// IPC: только от наших страниц (UI оркестратора или локальная страница статуса)
	const trusted = (e: IpcMainEvent): boolean => {
		const url = e.senderFrame?.url ?? ''
		return url.startsWith('file:') || sameOrigin(url, host.baseUrl)
	}
	ipcMain.on(IPC.openMain, (e, query: unknown) => {
		if (!trusted(e)) return
		popover.hide()
		mainWindow.open(sanitizeQuery(query))
	})
	ipcMain.on(IPC.hidePopover, e => {
		if (trusted(e)) popover.hide()
	})
	ipcMain.on(IPC.retry, e => {
		if (trusted(e)) void host.ensure()
	})
	ipcMain.on(IPC.quit, e => {
		if (trusted(e)) app.quit()
	})

	app.on('second-instance', () => mainWindow.open())
	app.on('activate', () => mainWindow.open())
	// окно закрыли — приложение остаётся в строке меню, оркестратор работает
	app.on('window-all-closed', () => {
		/* не выходим */
	})

	app.on('before-quit', e => {
		if (stopped) return
		e.preventDefault()
		if (quitting) return
		quitting = true
		globalShortcut.unregisterAll()
		stream?.stop()
		notifier.closeAll()
		windowFile.flush()
		settingsFile.flush()
		const hardStop = setTimeout(() => finish(), 10000)
		void host.stop().finally(() => {
			clearTimeout(hardStop)
			finish()
		})
	})
	const finish = (): void => {
		stopped = true
		host.killSync()
		tray?.destroy()
		app.quit()
	}
	// любой выход (в т.ч. аварийный) гасит запущенные nessy serve
	process.on('exit', () => host.killSync())
	process.on('uncaughtException', e => console.error('[nessy-desktop] необработанная ошибка:', e))

	void app.whenReady().then(async () => {
		nativeTheme.themeSource = settings.theme
		Menu.setApplicationMenu(appMenu())
		if (app.getLoginItemSettings().openAtLogin !== settings.openAtLogin) app.setLoginItemSettings({ openAtLogin: settings.openAtLogin })
		tray = new StatusTray({
			frames: trayFrames(),
			onClick: bounds => popover.toggle(bounds),
			menu: trayMenu,
		})
		if (!globalShortcut.register(SHORTCUT, () => popover.toggle(tray?.bounds ?? null))) log('горячая клавиша ⌥⌘N занята другим приложением')
		// запуск при входе — тихо, в строку меню; обычный запуск — сразу окно
		const atLogin = app.getLoginItemSettings().wasOpenedAtLogin === true
		if (!atLogin) mainWindow.open()
		updateDock()

		const env = await applyLoginEnv(process.env)
		if (env.error) log(`окружение ${env.shell}: ${env.error}`)
		else log(`окружение ${env.shell}: обновлено переменных ${env.changed.length}`)
		await host.ensure()
		popover.warmUp()
	})
}
