import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// UI собирается в ui/dist — оттуда его раздаёт оркестратор (Config.uiDir).
// В dev-режиме API проксируется на запущенный оркестратор; Host/Origin переписываем,
// потому что сервер принимает только свой loopback-адрес (защита от DNS-rebinding).
const ORCH = `http://127.0.0.1:${process.env['ORCH_PORT'] ?? '4337'}`
const API = ['/health', '/status', '/graph', '/stream', '/spaces', '/agents', '/messages', '/inbox', '/roles']

export default defineConfig({
	root: 'ui',
	base: './',
	plugins: [react()],
	resolve: {
		alias: {
			'@contract': fileURLToPath(new URL('./shared/types', import.meta.url)),
			'@': fileURLToPath(new URL('./ui/src', import.meta.url)),
		},
	},
	build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 800 },
	server: {
		port: 5173,
		proxy: Object.fromEntries(
			API.map(p => [
				p,
				{
					target: ORCH,
					changeOrigin: true,
					configure: proxy => {
						proxy.on('proxyReq', req => req.removeHeader('origin'))
					},
				},
			]),
		),
	},
})
