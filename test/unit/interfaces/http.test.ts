import assert from 'node:assert/strict'
import type * as http from 'node:http'
import { describe, it } from 'node:test'
import { AppError } from '../../../src/domain/errors'
import { assertLocalClient } from '../../../src/interfaces/http/guard'
import { parseApprove, parseRoleRequest, parseSendRequest, parseSpaceRequest, parseSpawnRequest, parseTaskPatch, parseTaskRequest } from '../../../src/interfaces/http/parsers'
import { queryNum } from '../../../src/interfaces/http/respond'
import { Router } from '../../../src/interfaces/http/router'
import { buildRouter } from '../../../src/interfaces/http/server'

const errCode = (fn: () => unknown): string => {
	try {
		fn()
	} catch (e) {
		return e instanceof AppError ? `${e.status}:${e.code}` : 'other'
	}
	return 'ok'
}

describe('HTTP: маршрутизатор', () => {
	it('сопоставляет шаблоны с параметрами по методу и длине', () => {
		const r = new Router()
		const h = (): void => undefined
		r.add('GET', '/agents/:ref', h).add('POST', '/agents/:ref/permission/:requestId', h)
		assert.deepEqual(r.match('GET', ['agents', 'a-1'])?.params, { ref: 'a-1' })
		assert.deepEqual(r.match('POST', ['agents', 'x', 'permission', 'r1'])?.params, { ref: 'x', requestId: 'r1' })
		assert.equal(r.match('DELETE', ['agents', 'a-1']), null)
		assert.equal(r.match('GET', ['agents', 'a-1', 'extra']), null)
	})
	it('все маршруты API на месте', () => {
		const r = buildRouter()
		assert.deepEqual([...r.roots()].sort(), ['agents', 'graph', 'health', 'inbox', 'messages', 'roles', 'spaces', 'status', 'stream', 'tasks'])
		const routes: Array<[string, string[]]> = [
			['GET', ['health']],
			['GET', ['status']],
			['GET', ['graph']],
			['GET', ['stream']],
			['GET', ['spaces']],
			['POST', ['spaces']],
			['DELETE', ['spaces', 'x']],
			['GET', ['agents']],
			['POST', ['agents']],
			['GET', ['tasks']],
			['POST', ['tasks']],
			['GET', ['tasks', 'x']],
			['PATCH', ['tasks', 'x']],
			['DELETE', ['tasks', 'x']],
			['GET', ['agents', 'x']],
			['DELETE', ['agents', 'x']],
			['GET', ['agents', 'x', 'history']],
			['GET', ['agents', 'x', 'stream']],
			['POST', ['agents', 'x', 'send']],
			['POST', ['agents', 'x', 'cancel']],
			['POST', ['agents', 'x', 'archive']],
			['POST', ['agents', 'x', 'restore']],
			['GET', ['roles']],
			['POST', ['roles']],
			['GET', ['roles', 'r']],
			['PUT', ['roles', 'r']],
			['DELETE', ['roles', 'r']],
			['POST', ['agents', 'x', 'permission', 'r']],
			['GET', ['messages']],
			['GET', ['inbox']],
		]
		for (const [m, seg] of routes) assert.ok(r.match(m, seg), `${m} /${seg.join('/')}`)
	})
})

describe('HTTP: проверка Host/Origin', () => {
	const req = (headers: Record<string, string>): http.IncomingMessage => ({ headers }) as unknown as http.IncomingMessage
	it('разрешает только свой loopback', () => {
		assert.equal(errCode(() => assertLocalClient(req({ host: '127.0.0.1:4337' }), 4337)), 'ok')
		assert.equal(errCode(() => assertLocalClient(req({ host: 'LOCALHOST:4337', origin: 'http://localhost:4337' }), 4337)), 'ok')
		assert.equal(errCode(() => assertLocalClient(req({ host: 'evil.example' }), 4337)), '403:bad_host')
		assert.equal(errCode(() => assertLocalClient(req({ host: '127.0.0.1:9999' }), 4337)), '403:bad_host')
		assert.equal(errCode(() => assertLocalClient(req({ host: '127.0.0.1:4337', origin: 'http://evil.example' }), 4337)), '403:bad_origin')
	})
})

describe('HTTP: разбор тел запросов', () => {
	it('spaces', () => {
		assert.deepEqual(parseSpaceRequest({ path: '/x', name: '', url: 'http://u' }), { path: '/x', name: undefined, url: 'http://u' })
		assert.equal(errCode(() => parseSpaceRequest({})), '400:bad_request')
	})
	it('spawn', () => {
		assert.deepEqual(parseSpawnRequest({ space: 's', prompt: 'p', role: 'rev', task: 't-1', wait: true, waitTimeoutSec: 5, junk: 1 }), {
			space: 's',
			name: undefined,
			role: 'rev',
			task: 't-1',
			prompt: 'p',
			parent: undefined,
			from: undefined,
			wait: true,
			waitTimeoutSec: 5,
		})
		assert.equal(parseSpawnRequest({ wait: 'yes' }).wait, false)
		assert.equal(errCode(() => parseSpawnRequest([])), '400:bad_request')
	})
	it('send и permission', () => {
		assert.deepEqual(parseSendRequest({ text: 'hi', from: 'a-1' }), { text: 'hi', from: 'a-1', interrupt: undefined, wait: false, waitTimeoutSec: undefined })
		assert.equal(parseSendRequest({ text: 'hi', interrupt: false }).interrupt, false)
		assert.equal(parseSendRequest({ text: 'hi', interrupt: 'no' }).interrupt, undefined)
		assert.equal(errCode(() => parseSendRequest({ text: 1 })), '400:bad_request')
		assert.equal(parseApprove({}), true)
		assert.equal(parseApprove({ approve: false }), false)
		assert.equal(parseApprove(null), true)
	})
	it('задачи', () => {
		assert.deepEqual(parseTaskRequest({ title: 'T', owner: 'claude', junk: 1 }), { title: 'T', owner: 'claude', id: undefined })
		assert.deepEqual(parseTaskRequest({ title: 'T', owner: null, id: 'x' }), { title: 'T', owner: undefined, id: 'x' })
		assert.equal(errCode(() => parseTaskRequest({})), '400:bad_request')
		assert.equal(errCode(() => parseTaskRequest({ title: 'T', id: 1 })), '400:bad_request')
		assert.deepEqual(parseTaskPatch({ status: 'done', summary: null, junk: 1 }), { status: 'done', summary: null })
		assert.deepEqual(parseTaskPatch({}), {})
		assert.equal(errCode(() => parseTaskPatch({ status: 'closed' })), '400:bad_request')
		assert.equal(errCode(() => parseTaskPatch({ summary: 1 })), '400:bad_request')
		assert.equal(errCode(() => parseTaskPatch(null)), '400:bad_request')
	})
	it('роли', () => {
		assert.deepEqual(parseRoleRequest({ name: 'R', instructions: 'i', color: 10, junk: 1 }), {
			name: 'R',
			instructions: 'i',
			description: undefined,
			color: 10,
			id: undefined,
		})
		assert.equal(errCode(() => parseRoleRequest({ name: 'R' })), '400:bad_request')
		assert.equal(errCode(() => parseRoleRequest({ name: 'R', instructions: 'i', color: '1' })), '400:bad_request')
		assert.equal(errCode(() => parseRoleRequest({ name: 'R', instructions: 'i', id: 5 })), '400:bad_request')
	})
	it('числа из query', () => {
		assert.equal(queryNum('5', 1), 5)
		assert.equal(queryNum(null, 1), 1)
		assert.equal(queryNum('abc', 1), 1)
	})
})
