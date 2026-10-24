/** Рантайм агентов/пространств: проводка runtime из SpawnRequest/SpaceRequest через resolve в AgentView/SpaceView. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { ApiError, SpaceView, SpawnResponse } from '../../shared/types'
import { startHarness } from '../support/harness'
import type { Harness } from '../support/support.types'

const T = { timeout: 20000 }

describe('runtime агентов и пространств', () => {
	let h: Harness
	before(async () => {
		h = await startHarness()
	})
	after(() => h.close())

	it('spawn runtime=nessy-sdk: AgentView.runtime и SpaceView.runtime — nessy-sdk', T, async () => {
		const ws = path.join(h.base, 'sdk')
		fs.mkdirSync(ws)
		const r = await h.api<SpawnResponse>('POST', '/agents', { space: ws, runtime: 'nessy-sdk', name: 'sdk-agent' })
		assert.equal(r.status, 201, JSON.stringify(r.body))
		assert.equal(r.body.agent.runtime, 'nessy-sdk')
		const g = await h.api<{ spaces: SpaceView[] }>('GET', '/graph')
		const space = g.body.spaces.find(s => s.path === ws)
		assert.ok(space, 'пространство должно быть создано')
		assert.equal(space.runtime, 'nessy-sdk')
	})

	it('spawn runtime=tclaude в существующее nessy-sdk пространство → 409 runtime_mismatch', T, async () => {
		const ws = path.join(h.base, 'sdk2')
		fs.mkdirSync(ws)
		await h.api('POST', '/agents', { space: ws, name: 'sdk-agent2' })
		const r = await h.api<ApiError>('POST', '/agents', { space: ws, runtime: 'tclaude', name: 'x' })
		assert.equal(r.status, 409)
		assert.equal(r.body.code, 'runtime_mismatch')
	})

	it('неизвестный runtime в spawn и space → 400 bad_request', T, async () => {
		const ws = path.join(h.base, 'bad')
		fs.mkdirSync(ws)
		const spawn = await h.api<ApiError>('POST', '/agents', { space: ws, runtime: 'bogus' })
		assert.equal(spawn.status, 400)
		assert.equal(spawn.body.code, 'bad_request')
		const space = await h.api<ApiError>('POST', '/spaces', { path: ws, runtime: 'bogus' })
		assert.equal(space.status, 400)
		assert.equal(space.body.code, 'bad_request')
	})

	it('POST /spaces runtime=nessy-sdk: SpaceView.runtime = nessy-sdk', T, async () => {
		const ws = path.join(h.base, 'sp')
		fs.mkdirSync(ws)
		const r = await h.api<SpaceView>('POST', '/spaces', { path: ws, runtime: 'nessy-sdk' })
		assert.equal(r.status, 201)
		assert.equal(r.body.runtime, 'nessy-sdk')
	})
})
