import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { serviceEnv } from '../../../src/interfaces/cli/launchd'

describe('launchd: окружение сервиса', () => {
	it('переносит прокси, сертификаты и NESSY_*/DP_*, остальное — нет', () => {
		const env = serviceEnv(
			{
				HTTPS_PROXY: 'http://p:3128',
				no_proxy: 'localhost',
				NODE_EXTRA_CA_CERTS: '/ca.pem',
				NESSY_TOKEN: 't',
				DP_WORKDIR: '/dp',
				SECRET: 'x',
				EMPTY_PROXY: '',
				PATH: '/custom/bin:/usr/bin',
			},
			'/Users/u',
		)
		assert.equal(env['HTTPS_PROXY'], 'http://p:3128')
		assert.equal(env['no_proxy'], 'localhost')
		assert.equal(env['NODE_EXTRA_CA_CERTS'], '/ca.pem')
		assert.equal(env['NESSY_TOKEN'], 't')
		assert.equal(env['DP_WORKDIR'], '/dp')
		assert.equal(env['SECRET'], undefined)
		assert.equal(env['HOME'], '/Users/u')
	})

	it('PATH: сохраняет пользовательский и добавляет node и ~/.local/bin', () => {
		const p = serviceEnv({ PATH: '/custom/bin' }, '/Users/u')['PATH']?.split(':') ?? []
		assert.equal(p[0], '/custom/bin')
		assert.ok(p.includes('/Users/u/.local/bin'))
		assert.ok(p.includes('/usr/bin'))
	})
})
