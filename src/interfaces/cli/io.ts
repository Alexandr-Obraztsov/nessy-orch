/** Ввод-вывод CLI: stdout — полезный результат, stderr — служебное; запросы к оркестратору. */
import { endpoint, request } from './client'

export const ep = endpoint()

export function out(s: string): void {
	process.stdout.write(s + '\n')
}

export function info(s: string): void {
	process.stderr.write(s + '\n')
}

export function json(v: unknown): void {
	out(JSON.stringify(v, null, 2))
}

export const get = <T>(path: string): Promise<T> => request(ep, 'GET', path) as Promise<T>
export const post = <T>(path: string, body: unknown): Promise<T> => request(ep, 'POST', path, body) as Promise<T>
export const del = (path: string): Promise<unknown> => request(ep, 'DELETE', path)

/** Компонент пути (id/имя агента, имя пространства). */
export const enc = encodeURIComponent
