/** Установка оркестратора как launchd-сервиса (macOS). Запускать вне песочницы. */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { errMsg } from '../core/json'
import { CliError } from './client'

const LABEL = 'com.nessy.orch'

function plist(): string {
	const root = path.resolve(__dirname, '..', '..', '..')
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
    <key>PATH</key><string>${path.dirname(process.execPath)}:${home}/.local/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>${home}</string>
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
	process.stdout.write(`✓ сервис ${LABEL} установлен и запущен\n  перезапуск: launchctl kickstart -k ${domain()}/${LABEL}\n  логи: ~/.nessy-orch/logs/orch.{out,err}.log\n`)
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
