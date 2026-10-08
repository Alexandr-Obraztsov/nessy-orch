/**
 * E2E-тесты UI (Playwright). Перед запуском нужна сборка: `npm run build`
 * (dist/src/main.js, dist/test/support/fake-nessy.js, ui/dist).
 * Браузер: PW_CHROMIUM_PATH (путь к chromium), иначе штатный — `npx playwright install chromium`.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// порты можно переопределить, чтобы параллельные прогоны не мешали друг другу
const PORT = Number(process.env['PW_PORT'] || 4399)
const SERVE_PORT = process.env['PW_SERVE_PORT'] || '4800'
const OUT = process.env['PW_OUT'] || '.'
const BASE = `http://127.0.0.1:${PORT}`
const executablePath = process.env['PW_CHROMIUM_PATH'] || undefined
const launchOptions = { executablePath }

// свежий домашний каталог оркестратора на каждый запуск конфига
const home = mkdtempSync(path.join(tmpdir(), 'nessy-orch-e2e-'))

const viewport = (width: number, height: number) => ({ viewport: { width, height } })
const touch = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }

export default defineConfig({
	testDir: './e2e',
	outputDir: path.join(OUT, 'test-results'),
	reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(OUT, 'playwright-report') }]],
	workers: 1,
	fullyParallel: false,
	retries: 0,
	timeout: 45_000,
	expect: { timeout: 10_000 },
	use: {
		baseURL: BASE,
		trace: 'retain-on-failure',
		launchOptions,
		...devices['Desktop Chrome'],
	},
	projects: [
		{ name: 'desktop', use: { ...viewport(1440, 900) } },
		{ name: 'laptop', use: { ...viewport(1024, 768) } },
		{ name: 'tablet', use: { ...viewport(768, 1024) } },
		{ name: 'mobile', use: { ...viewport(390, 844), ...touch } },
		{ name: 'small', use: { ...viewport(360, 740), ...touch } },
	],
	webServer: {
		command: 'node dist/src/main.js',
		url: `${BASE}/health`,
		reuseExistingServer: false,
		timeout: 30_000,
		env: {
			ORCH_PORT: String(PORT),
			NESSY_BIN: path.resolve(__dirname, 'dist/test/support/fake-nessy.js'),
			NESSY_ORCH_HOME: home,
			SERVE_BASE_PORT: SERVE_PORT,
			FAKE_NESSY_DELAY_MS: '20',
		},
	},
})
