/**
 * Preload (песочница, contextIsolation): кладёт `window.nessyDesktop` для UI, а на локальной
 * странице статуса — ещё `window.nessyShell`. Импортировать можно только 'electron' и типы:
 * строки каналов продублированы из lib/ipc.ts (их сверяет тест).
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { DesktopMode, NessyDesktop, NessyShell, ShellStatus } from './preload.types'

const argValue = (prefix: string): string | null => {
	const hit = process.argv.find(a => a.startsWith(prefix))
	return hit === undefined ? null : hit.slice(prefix.length)
}

function detectMode(): DesktopMode {
	const fromArg = argValue('--nessy-mode=')
	const fromQuery = new URLSearchParams(window.location.search).get('desktop')
	return (fromArg ?? fromQuery) === 'popover' ? 'popover' : 'window'
}

const desktop: NessyDesktop = {
	isDesktop: true,
	platform: process.platform,
	mode: detectMode(),
	openMain: (query?: string) => {
		ipcRenderer.send('nessy:open-main', typeof query === 'string' ? query : '')
	},
	hidePopover: () => {
		ipcRenderer.send('nessy:hide-popover')
	},
	orchestrator: { url: argValue('--nessy-url=') ?? 'http://127.0.0.1:4337' },
}

contextBridge.exposeInMainWorld('nessyDesktop', desktop)

if (window.location.protocol === 'file:') {
	const shell: NessyShell = {
		retry: () => {
			ipcRenderer.send('nessy:retry')
		},
		quit: () => {
			ipcRenderer.send('nessy:quit')
		},
		onStatus: listener => {
			const handler = (_e: IpcRendererEvent, status: ShellStatus): void => listener(status)
			ipcRenderer.on('nessy:status', handler)
			return () => {
				ipcRenderer.removeListener('nessy:status', handler)
			}
		},
	}
	contextBridge.exposeInMainWorld('nessyShell', shell)
}
