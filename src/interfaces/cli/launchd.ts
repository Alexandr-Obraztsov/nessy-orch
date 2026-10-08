/** Установка оркестратора как launchd-сервиса (macOS). Запускать вне песочницы. */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { projectRoot } from '../../infrastructure/config/load-config'
import { errMsg } from '../../lib/json'
import { CliError } from './errors'

const LABEL = 'com.nessy.orch'

/**
 * Переменные окружения, которые переносятся из терминала в launchd-сервис.
 * launchd запускает процесс с почти пустым окружением, а nessy (и его канал nessy-acp-agent) нужны прокси,
 * корпоративные сертификаты, токены и настройки nessy/dp — без них создание сессии зависает (newSession timeout).
 */
const ENV_NAMES = new Set([
	'PATH',
	'LANG',
	'LC_ALL',
	'SHELL',
	'USER',
	'LOGNAME',
	'TMPDIR',
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'NO_PROXY',
	'ALL_PROXY',
	'http_proxy',
	'https_proxy',
	'no_proxy',
	'all_proxy',
	'NODE_EXTRA_CA_CERTS',
	'NODE_OPTIONS',
	'SSL_CERT_FILE',
	'SSL_CERT_DIR',
	'REQUESTS_CA_BUNDLE',
	'CURL_CA_BUNDLE',
	'GIT_SSL_CAINFO',
])
const ENV_PREFIXES = ['NESSY_', 'NESTOR_', 'DP_', 'ORCH_', 'MAX_SESSIONS', 'SERVE_BASE_PORT']

const xmlEscape = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Окружение для plist: нужное из текущего терминала + гарантированный PATH с node и ~/.local/bin. */
export function serviceEnv(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [k, v] of Object.entries(env)) {
		if (v === undefined || v === '') continue
		if (ENV_NAMES.has(k) || ENV_PREFIXES.some(p => k.startsWith(p))) out[k] = v
	}
	const must = [path.dirname(process.execPath), `${home}/.local/bin`, '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin']
	const parts = (out['PATH'] ?? '').split(':').filter(Boolean)
	for (const m of must) if (!parts.includes(m)) parts.push(m)
	out['PATH'] = parts.join(':')
	out['HOME'] = home
	return out
}

function plist(): string {
	const root = projectRoot()
	const home = os.homedir()
	const logs = path.join(home, '.nessy-orch', 'logs')
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${path.join(root, 'dist', 'src', 'main.js')}</string>
  </array>
  <key>WorkingDirectory</key><string>${root}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(serviceEnv(process.env, home))
	.map(([k, v]) => `    <key>${xmlEscape(k)}</key><string>${xmlEscape(v)}</string>`)
	.join('\n')}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${logs}/orch.out.log</string>
  <key>StandardErrorPath</key><string>${logs}/orch.err.log</string>
</dict>
</plist>
`
}

const plistPath = (): string => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const domain = (): string => `gui/${process.getuid?.() ?? 501}`

export function install(opts: { print: boolean }): Promise<void> {
	const xml = plist()
	if (opts.print) {
		process.stdout.write(xml)
		return Promise.resolve()
	}
	try {
		fs.mkdirSync(path.join(os.homedir(), '.nessy-orch', 'logs'), { recursive: true })
		fs.mkdirSync(path.dirname(plistPath()), { recursive: true })
		fs.writeFileSync(plistPath(), xml)
	} catch (e) {
		throw new CliError(`не удалось записать ${plistPath()} (${errMsg(e)}). Запустите команду вне песочницы или используйте --print`)
	}
	try {
		execFileSync('launchctl', ['bootout', `${domain()}/${LABEL}`], { stdio: 'ignore' })
	} catch {
		/* сервис ещё не был загружен */
	}
	execFileSync('launchctl', ['bootstrap', domain(), plistPath()], { stdio: 'inherit' })
	const names = Object.keys(serviceEnv()).sort().join(', ')
	process.stdout.write(`✓ сервис ${LABEL} установлен и запущен\n  окружение из этого терминала: ${names}\n  (изменили прокси/сертификаты/токены — переустановите: nessy-orch install)\n  перезапуск: launchctl kickstart -k ${domain()}/${LABEL}\n  логи: ~/.nessy-orch/logs/orch.{out,err}.log\n`)
	return Promise.resolve()
}

export function uninstall(): Promise<void> {
	try {
		execFileSync('launchctl', ['bootout', `${domain()}/${LABEL}`], { stdio: 'inherit' })
	} catch {
		/* не был загружен */
	}
	if (fs.existsSync(plistPath())) fs.unlinkSync(plistPath())
	process.stdout.write(`✓ сервис ${LABEL} удалён\n`)
	return Promise.resolve()
}
