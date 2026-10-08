// Ставит exec-биты на собранные точки входа. UI собирает Vite (см. vite.config.ts).
import { chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const f of ['dist/src/main.js', 'dist/src/cli/main.js', 'dist/test/fake-nessy.js']) {
	const p = join(root, f)
	if (existsSync(p)) chmodSync(p, 0o755)
}
console.log('[postbuild] ok')
