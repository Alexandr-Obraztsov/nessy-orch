/** Каталог рантаймов из конфигурации процесса: дефолтные модели из env и доступность бинаря tclaude. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RuntimeCatalogSource } from '../../application/ports'
import { builtinRuntimes } from '../../application/runtime-catalog'
import type { Config } from './config.types'

/** Исполняемый файл по пути или в PATH. */
export function isExecutableOnPath(bin: string, pathEnv: string | undefined = process.env['PATH']): boolean {
	const executable = (file: string): boolean => {
		try {
			fs.accessSync(file, fs.constants.X_OK)
			return fs.statSync(file).isFile()
		} catch {
			return false
		}
	}
	if (bin.includes('/')) return executable(bin)
	return (pathEnv ?? '').split(path.delimiter).some(dir => dir !== '' && executable(path.join(dir, bin)))
}

export function buildRuntimeCatalog(config: Pick<Config, 'sdkModel' | 'tclaudeModel' | 'tclaudeBin'>): RuntimeCatalogSource {
	return () =>
		builtinRuntimes({
			sdkModel: config.sdkModel,
			tclaudeModel: config.tclaudeModel,
			tclaudeAvailable: isExecutableOnPath(config.tclaudeBin ?? 'tclaude'),
		})
}
