/** API: служебные эндпоинты, защита Host/Origin, ошибки, пространства. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { ApiError, GraphView, SpaceView, SpawnResponse, StatusResponse } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'

const T = { timeout: 20000 }

describe('API: служебное и защита', () => {
	let h: Harness
	before(async () => {
		h = await startHarness()
	})
	after(() => h.close())

	it('GET /health, /status, /graph', T, async () => {
		assert.deepEqual((await h.api('GET', '/health')).body, { status: 'ok' })
		const s = await h.api<StatusResponse>('GET', '/status')
		assert.equal(s.status, 200)
		assert.equal(s.body.version, 'test')
		assert.equal(s.body.home, h.home)
		assert.equal(s.body.autoApprove, true)
		assert.equal(s.body.pid, process.pid)
		const g = await h.api<GraphView>('GET', '/graph')
		assert.deepEqual(g.body, { rev: g.body.rev, spaces: [], agents: [] })
	})

	it('чужой Host и Origin → 403', T, async () => {
		const host = await h.api<ApiError>('GET', '/graph', undefined, { Host: 'evil.example' })
		assert.equal(host.status, 403)
		assert.equal(host.body.code, 'bad_host')
		const rebinding = await h.api<ApiError>('GET', '/graph', undefined, { Host: `evil.example:${h.port}` })
		assert.equal(rebinding.status, 403)
		const origin = await h.api<ApiError>('POST', '/spaces', { path: h.ws }, { Origin: 'http://evil.example' })
		assert.equal(origin.status, 403)
		assert.equal(origin.body.code, 'bad_origin')
		assert.equal((await h.api('GET', '/graph', undefined, { Origin: `http://localhost:${h.port}` })).status, 200)
		assert.equal(h.orch.graph().spaces.length, 0, 'запрос с чужим Origin ничего не изменил')
	})

	it('ошибки: неизвестный маршрут, битый JSON, статика без UI', T, async () => {
		const nf = await h.api<ApiError>('POST', '/nope')
		assert.equal(nf.status, 404)
		assert.equal(nf.body.code, 'not_found')
		assert.equal((await h.api<ApiError>('GET', '/agents/a/b/c')).status, 404)
		const bad = await new Promise<number>((resolve, reject) => {
			import('node:http')
				.then(http => {
					const req = http.request({ host: '127.0.0.1', port: h.port, method: 'POST', path: '/spaces', headers: { 'Content-Type': 'application/json' } }, res => {
						res.resume()
						resolve(res.statusCode ?? 0)
					})
					req.on('error', reject)
					req.end('{не json')
				})
				.catch(reject)
		})
		assert.equal(bad, 400)
		const ui = await h.api<ApiError>('GET', '/')
		assert.equal(ui.status, 404)
		assert.match(ui.body.error, /UI не найден/)
	})

	it('статика UI раздаётся и не выходит за каталог', T, async () => {
		const uiDir = path.join(h.base, 'ui')
		fs.mkdirSync(uiDir, { recursive: true })
		fs.writeFileSync(path.join(uiDir, 'index.html'), '<h1>ui</h1>')
		const r = await h.api<{ raw: string }>('GET', '/')
		assert.equal(r.status, 200)
		assert.equal(r.body.raw, '<h1>ui</h1>')
		assert.equal((await h.api('GET', '/../package.json')).status, 404)
	})
})

describe('API: пространства', () => {
	let h: Harness
	before(async () => {
		h = await startHarness()
	})
	after(() => h.close())

	it('spawn без пространств → 400 space_required', T, async () => {
		const r = await h.api<ApiError>('POST', '/agents', { name: 'x' })
		assert.equal(r.status, 400)
		assert.equal(r.body.code, 'space_required')
	})

	it('add / list / повторное добавление / ошибки', T, async () => {
		const r = await h.api<SpaceView>('POST', '/spaces', { path: h.ws + '/', name: 'main' })
		assert.equal(r.status, 201)
		assert.equal(r.body.name, 'main')
		assert.equal(r.body.path, h.ws)
		assert.equal(r.body.mode, 'managed')
		assert.equal(r.body.status, 'stopped')
		const again = await h.api<SpaceView>('POST', '/spaces', { path: h.ws })
		assert.equal(again.body.name, 'main', 'тот же путь — то же пространство')
		const other = path.join(h.base, 'other')
		fs.mkdirSync(other)
		assert.equal((await h.api<ApiError>('POST', '/spaces', { path: other, name: 'main' })).body.code, 'space_exists')
		assert.equal((await h.api<ApiError>('POST', '/spaces', { path: 'relative' })).body.code, 'bad_path')
		assert.equal((await h.api<ApiError>('POST', '/spaces', { path: '/definitely/missing' })).body.code, 'bad_path')
		assert.equal((await h.api<ApiError>('POST', '/spaces', {})).body.code, 'bad_request')
		const list = await h.api<SpaceView[]>('GET', '/spaces')
		assert.deepEqual(
			list.body.map(s => s.name),
			['main'],
		)
	})

	it('пространство по пути создаётся лениво при spawn; удаление с агентами требует force', T, async () => {
		const lazy = path.join(h.base, 'lazy')
		fs.mkdirSync(lazy)
		const sp = await h.api<SpawnResponse>('POST', '/agents', { space: lazy, name: 'lazy-agent' })
		assert.equal(sp.status, 201)
		assert.equal(sp.body.agent.space, 'lazy')
		const busy = await h.api<ApiError>('DELETE', '/spaces/lazy')
		assert.equal(busy.status, 409)
		assert.equal(busy.body.code, 'space_busy')
		assert.equal((await h.api('DELETE', '/spaces/lazy?force=1')).status, 200)
		assert.equal(h.orch.registry.agents.size, 0)
		assert.equal((await h.api<ApiError>('DELETE', '/spaces/lazy')).status, 404)
		assert.equal((await h.api('DELETE', '/spaces/main')).status, 200)
		assert.deepEqual((await h.api<SpaceView[]>('GET', '/spaces')).body, [])
	})
})
